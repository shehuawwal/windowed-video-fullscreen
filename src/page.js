/*
 * Windowed Video Fullscreen — page-world script.
 *
 * Runs in the page's MAIN world at document_start, in every frame. It replaces
 * the Fullscreen API so that "fullscreen" requests fill the browser tab's
 * viewport instead of the whole screen.
 *
 * It can't use extension APIs. Settings arrive from bridge.js (isolated world)
 * as JSON strings on CustomEvents dispatched on `document`.
 *
 * See AGENTS.md for the architecture and the rules for changing this file.
 */
(() => {
  "use strict";

  const FLAG = "__wvfsInstalled";
  if (window[FLAG]) return;
  try {
    Object.defineProperty(window, FLAG, { value: true });
  } catch (_) {
    return;
  }

  // ---------------------------------------------------------------------------
  // Constants and settings
  // ---------------------------------------------------------------------------

  const MSG_KEY = "__wvfs"; // marker on window.postMessage payloads between frames
  const EV_SETTINGS = "wvfs:settings"; // bridge -> page: JSON settings
  const EV_HELLO = "wvfs:hello"; // page -> bridge: "send me settings"
  const EV_COMMAND = "wvfs:command"; // bridge -> page: "toggle" | "exit"
  const EV_QUERY = "wvfs:query"; // bridge -> page: "what is your state?"
  const EV_STATE = "wvfs:state"; // page -> bridge: JSON state answer
  const MAX_Z = "2147483647";
  const CLICK_WINDOW_MS = 600; // an exit request this soon after a click counts as "caused by the click"

  // Used until bridge.js delivers the stored settings (normally within a few ms).
  // Keep in sync with DEFAULTS in src/shared/settings.js.
  let settings = {
    enabled: true,
    siteDisabled: false,
    mode: "inplace",
    clickProtection: true,
    convertNative: true,
    ignoreWhileTyping: true,
    quality: "1080", // preferred height when windowed; "" = leave the site's choice
    shortcuts: {
      toggle: [{ code: "KeyF", ctrl: true, shift: true, alt: false, meta: false }],
      exit: [{ code: "Escape", ctrl: false, shift: false, alt: false, meta: false }]
    }
  };
  let parentDisabled = false; // set by the parent frame when the top-level site is disabled

  const isTop = (() => {
    try {
      return window.top === window;
    } catch (_) {
      return false;
    }
  })();

  function isEnabled() {
    return !!settings.enabled && !settings.siteDisabled && !parentDisabled;
  }

  // ---------------------------------------------------------------------------
  // Native API references (saved before we patch anything)
  // ---------------------------------------------------------------------------

  const ElementProto = Element.prototype;
  const DocProto = Document.prototype;
  const VideoProto = HTMLVideoElement.prototype;

  const native = {
    request: ElementProto.requestFullscreen,
    webkitRequest: ElementProto.webkitRequestFullscreen,
    webkitRequestCaps: ElementProto.webkitRequestFullScreen,
    mozRequest: ElementProto.mozRequestFullScreen,
    exit: DocProto.exitFullscreen,
    webkitExit: DocProto.webkitExitFullscreen,
    webkitCancel: DocProto.webkitCancelFullScreen,
    mozCancel: DocProto.mozCancelFullScreen,
    videoEnter: VideoProto.webkitEnterFullscreen,
    videoEnterCaps: VideoProto.webkitEnterFullScreen
  };

  function nativeGetter(name) {
    const d = Object.getOwnPropertyDescriptor(DocProto, name);
    return d && typeof d.get === "function" ? d.get : null;
  }

  const nativeFullscreenElementGetter =
    nativeGetter("fullscreenElement") || nativeGetter("webkitFullscreenElement") || nativeGetter("mozFullScreenElement");

  function nativeFullscreenElement() {
    try {
      return nativeFullscreenElementGetter ? nativeFullscreenElementGetter.call(document) : null;
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const state = {
    active: false,
    element: null, // what the page asked to fullscreen (reported as document.fullscreenElement)
    target: null, // what we actually resize (element, or a player wrapper around a <video>)
    kind: null, // "self" (a player in this frame) | "frame" (an <iframe> whose child is fullscreen)
    childWin: null, // for kind "frame": the child frame's window
    mode: null, // "inplace" | "overlay"
    toldParent: false, // we asked our parent frame to maximise our <iframe>
    saved: new Map(), // Element -> Map(prop -> [value, priority]) for restoring inline styles
    ancestors: [],
    overlay: null,
    placeholder: null,
    scroll: null,
    observer: null,
    reacquireTimer: 0
  };

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  // Parent in the flat tree: crosses slots and shadow roots.
  function flatParent(node) {
    if (!node) return null;
    if (node.assignedSlot) return node.assignedSlot;
    if (node.parentElement) return node.parentElement;
    const p = node.parentNode;
    return p && p.host ? p.host : null;
  }

  function isVideo(el) {
    return el instanceof HTMLVideoElement;
  }

  function area(el) {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  }

  function isVisibleBox(el, minW, minH) {
    const r = el.getBoundingClientRect();
    if (r.width < minW || r.height < minH) return false;
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  // All <video> elements under root, including inside open shadow roots.
  function allVideos(root) {
    const out = [];
    const walk = (r) => {
      for (const v of r.querySelectorAll("video")) out.push(v);
      for (const n of r.querySelectorAll("*")) if (n.shadowRoot) walk(n.shadowRoot);
    };
    walk(root);
    return out;
  }

  function largestVideo(root) {
    let best = null;
    let bestArea = 0;
    for (const v of allVideos(root)) {
      const a = area(v);
      if (a > bestArea) {
        best = v;
        bestArea = a;
      }
    }
    return best;
  }

  // The video a keyboard toggle should act on: visible, prefer playing, then largest.
  function pickVideo() {
    const visible = allVideos(document).filter((v) => isVisibleBox(v, 100, 60));
    if (!visible.length) return null;
    visible.sort((a, b) => {
      const pa = !a.paused && !a.ended ? 1 : 0;
      const pb = !b.paused && !b.ended ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return area(b) - area(a);
    });
    return visible[0];
  }

  function pickFrame() {
    const frames = Array.from(document.querySelectorAll("iframe, frame")).filter((f) => isVisibleBox(f, 200, 120));
    frames.sort((a, b) => area(b) - area(a));
    return frames[0] || null;
  }

  function frameElementFor(win) {
    for (const f of document.querySelectorAll("iframe, frame")) {
      if (f.contentWindow === win) return f;
    }
    return null;
  }

  // For a bare <video>, prefer a surrounding player wrapper so the site's own
  // controls (play/pause, timeline, captions) stay visible.
  function findPlayerTarget(el) {
    if (!isVideo(el)) return el;
    const hintSelectors = [
      '[data-testid="videoPlayer"]',
      '[data-testid="videoComponent"]',
      '[class*="videoPlayer"]',
      '[class*="video-player"]',
      '[class*="player-container"]',
      '[class*="PlayerContainer"]',
      '[class*="media-container"]'
    ];
    const vr = el.getBoundingClientRect();
    let fallback = el;
    let node = flatParent(el);
    for (let depth = 0; node && node !== document.body && node !== document.documentElement && depth < 8; depth++) {
      const r = node.getBoundingClientRect();
      // Stop once a wrapper is much bigger than the video: that's page layout, not the player.
      if (vr.width > 0 && vr.height > 0 && (r.width > vr.width * 1.6 || r.height > vr.height * 1.8)) break;
      if (r.width >= 180 && r.height >= 100) {
        fallback = node;
        const cls = typeof node.className === "string" ? node.className : "";
        const hinted =
          /player|video|media/i.test(cls) ||
          hintSelectors.some((sel) => {
            try {
              return node.matches(sel);
            } catch (_) {
              return false;
            }
          });
        if (hinted) return node;
      }
      node = flatParent(node);
    }
    return fallback;
  }

  // ---------------------------------------------------------------------------
  // Inline style bookkeeping (only the properties we touch are restored)
  // ---------------------------------------------------------------------------

  function setStyles(el, props) {
    if (!el || !el.style) return;
    let rec = state.saved.get(el);
    if (!rec) {
      rec = new Map();
      state.saved.set(el, rec);
    }
    const keys = Object.keys(props);
    // Snapshot everything first: setting a shorthand (e.g. inset) changes its longhands.
    for (const prop of keys) {
      if (!rec.has(prop)) rec.set(prop, [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    }
    for (const prop of keys) el.style.setProperty(prop, props[prop], "important");
  }

  function restoreStyles() {
    for (const [el, rec] of state.saved) {
      for (const [prop, [value, priority]] of rec) {
        if (value) el.style.setProperty(prop, value, priority);
        else el.style.removeProperty(prop);
      }
      if (el.getAttribute("style") === "") el.removeAttribute("style");
    }
    state.saved.clear();
  }

  // Properties that make an ancestor the containing block for position:fixed
  // descendants (or otherwise trap them). Neutralised while active.
  const ANCESTOR_FIX = {
    transform: "none",
    translate: "none",
    rotate: "none",
    scale: "none",
    filter: "none",
    "backdrop-filter": "none",
    perspective: "none",
    contain: "none",
    "container-type": "normal",
    "content-visibility": "visible",
    "will-change": "auto",
    "clip-path": "none",
    mask: "none"
  };

  const TARGET_FIX = {
    position: "fixed",
    top: "0",
    left: "0",
    right: "auto",
    bottom: "auto",
    width: "100vw",
    height: "100vh",
    "min-width": "0",
    "min-height": "0",
    "max-width": "none",
    "max-height": "none",
    margin: "0",
    transform: "none",
    translate: "none",
    rotate: "none",
    scale: "none",
    "border-radius": "0",
    "box-sizing": "border-box",
    "aspect-ratio": "auto",
    "z-index": MAX_Z,
    background: "#000",
    visibility: "visible"
  };

  const SPINE_FIX = {
    width: "100%",
    height: "100%",
    "min-width": "0",
    "min-height": "0",
    "max-width": "none",
    "max-height": "none",
    margin: "0",
    "padding-top": "0",
    "padding-bottom": "0",
    "aspect-ratio": "auto",
    transform: "none"
  };

  function styleVideo(video) {
    const props = {
      width: "100%",
      height: "100%",
      "max-width": "none",
      "max-height": "none",
      "object-fit": "contain",
      transform: "none"
    };
    const pos = getComputedStyle(video).position;
    if (pos === "absolute" || pos === "fixed") {
      props.top = "0";
      props.left = "0";
      props.right = "auto";
      props.bottom = "auto";
    }
    setStyles(video, props);
  }

  // Size the main video and every wrapper between it and the target to fill the target.
  function styleInside(target) {
    const video = isVideo(target) ? target : largestVideo(target);
    if (!video) return;
    styleVideo(video);
    for (let n = flatParent(video); n && n !== target; n = flatParent(n)) setStyles(n, SPINE_FIX);
  }

  // ---------------------------------------------------------------------------
  // Apply / tear down (no events, no frame messages)
  // ---------------------------------------------------------------------------

  function applyInPlace(target) {
    const ancestors = [];
    for (let n = flatParent(target); n; n = flatParent(n)) ancestors.push(n);
    state.ancestors = ancestors;
    for (const a of ancestors) {
      const top = a === document.documentElement || a === document.body;
      setStyles(a, top ? ANCESTOR_FIX : Object.assign({ "z-index": MAX_Z }, ANCESTOR_FIX));
    }
    setStyles(target, TARGET_FIX);
    if (target instanceof HTMLIFrameElement || target instanceof HTMLFrameElement) setStyles(target, { border: "0" });
    styleInside(target);
  }

  function applyOverlay(target) {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-wvfs-overlay", "");
    overlay.style.cssText =
      [
        "position:fixed",
        "inset:0",
        "width:100vw",
        "height:100vh",
        "z-index:" + MAX_Z,
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "background:#000",
        "overflow:hidden",
        "margin:0",
        "padding:0"
      ].join(" !important;") + " !important;";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay && settings.clickProtection) e.stopPropagation();
    });
    (document.body || document.documentElement).appendChild(overlay);
    state.overlay = overlay;

    state.placeholder = document.createComment("wvfs-placeholder");
    target.parentNode.insertBefore(state.placeholder, target);
    overlay.appendChild(target);
    state.ancestors = [];

    setStyles(target, {
      position: "relative",
      inset: "auto",
      width: "100%",
      height: "100%",
      "max-width": "100%",
      "max-height": "100%",
      margin: "0",
      transform: "none",
      background: "#000"
    });
    styleInside(target);
  }

  function apply(el, kind) {
    const target = kind === "frame" ? el : findPlayerTarget(el);
    // Moving an <iframe> reloads it, and moving shadow-DOM content is unsafe, so
    // overlay mode is only used for plain light-DOM elements.
    const canMove = kind !== "frame" && target.parentNode && !(target.getRootNode() instanceof ShadowRoot);
    const wholePage = target === document.documentElement || target === document.body;
    // A request for the whole page (games, slide decks) already fills the tab.
    const mode = wholePage ? "page" : settings.mode === "overlay" && canMove ? "overlay" : "inplace";

    state.element = el;
    state.target = target;
    state.kind = kind;
    state.mode = mode;
    state.saved = new Map();

    try {
      if (mode === "overlay") applyOverlay(target);
      else if (mode === "inplace") applyInPlace(target);
    } catch (err) {
      teardown();
      throw err;
    }

    if (mode !== "page") {
      setStyles(document.documentElement, { overflow: "hidden" });
      if (document.body) setStyles(document.body, { overflow: "hidden" });
    }
    state.active = true;
  }

  function teardown() {
    clearTimeout(state.reacquireTimer);
    clearTimeout(qualityTimer);
    state.reacquireTimer = 0;
    const target = state.target;
    if (state.mode === "overlay" && target && state.placeholder) {
      try {
        if (state.placeholder.parentNode) state.placeholder.parentNode.insertBefore(target, state.placeholder);
      } catch (_) {}
    }
    if (state.placeholder) state.placeholder.remove();
    if (state.overlay) state.overlay.remove();
    restoreStyles();
    state.active = false;
    state.element = null;
    state.target = null;
    state.kind = null;
    state.mode = null;
    state.ancestors = [];
    state.overlay = null;
    state.placeholder = null;
  }

  // ---------------------------------------------------------------------------
  // Enter / exit (with events, observers and frame messages)
  // ---------------------------------------------------------------------------

  function fireChange(el) {
    const t = el && el.isConnected ? el : document;
    const types = ["fullscreenchange", "webkitfullscreenchange"];
    if (native.mozRequest) types.push("mozfullscreenchange");
    for (const type of types) {
      try {
        t.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
      } catch (_) {}
    }
  }

  function enter(el, kind, childWin) {
    if (!(el instanceof Element)) return false;
    if (state.active && state.element === el) return true;
    if (state.active) exit("replace");

    state.scroll = { x: scrollX, y: scrollY };
    try {
      apply(el, kind);
    } catch (_) {
      return false;
    }
    state.childWin = kind === "frame" ? childWin : null;
    startObserver();

    if (!isTop) {
      state.toldParent = true;
      postTo(window.parent, { type: "child-enter" });
    }
    fireChange(el);
    if (kind === "self") applyQuality(isVideo(el) ? el : largestVideo(state.target));
    return true;
  }

  // reason: "user" | "page" | "lost" | "replace" | "child" | "parent" | "disabled"
  function exit(reason) {
    if (!state.active) return;
    const el = state.element;
    const kind = state.kind;
    const childWin = state.childWin;
    const scroll = state.scroll;

    stopObserver();
    teardown();
    state.childWin = null;
    if (scroll) window.scrollTo(scroll.x, scroll.y);
    state.scroll = null;

    if (kind === "frame" && reason !== "child" && childWin) postTo(childWin, { type: "parent-exit" });
    if (state.toldParent && reason !== "parent" && reason !== "replace") postTo(window.parent, { type: "child-exit" });
    if (reason !== "replace") state.toldParent = false;
    fireChange(el);
  }

  function toggle() {
    if (state.active) {
      exit("user");
      return;
    }
    if (!isEnabled()) return;
    const v = pickVideo();
    if (v) {
      enter(v, "self");
      return;
    }
    const f = pickFrame();
    if (f && f.contentWindow) postTo(f.contentWindow, { type: "toggle" });
  }

  // ---------------------------------------------------------------------------
  // Keep working when the site re-renders the player
  // ---------------------------------------------------------------------------

  function startObserver() {
    stopObserver();
    state.observer = new MutationObserver(onMutation);
    state.observer.observe(document, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (state.observer) state.observer.disconnect();
    state.observer = null;
  }

  function onMutation() {
    if (!state.active || state.target.isConnected || state.reacquireTimer) return;
    state.reacquireTimer = setTimeout(() => {
      state.reacquireTimer = 0;
      if (!state.active || state.target.isConnected) return;
      // The site replaced the player (common in React/Vue apps). Look for a new
      // video close to where the old one was, and keep it windowed.
      if (state.kind === "self" && state.mode === "inplace") {
        const near = state.ancestors
          .slice(0, 4)
          .find((a) => a.isConnected && a !== document.body && a !== document.documentElement);
        const video = near && largestVideo(near);
        if (video && area(video) > 0) {
          const oldEl = state.element;
          teardown();
          try {
            apply(video, "self");
            if (oldEl !== video) fireChange(video);
            return;
          } catch (_) {}
        }
      }
      exit("lost");
    }, 250);
  }

  // ---------------------------------------------------------------------------
  // Click protection: clicking the video never exits windowed fullscreen
  // ---------------------------------------------------------------------------

  let lastPointer = { t: -Infinity, node: null };
  let lastKey = -Infinity;

  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "touchstart", "touchend"]) {
    window.addEventListener(
      type,
      (e) => {
        lastPointer = { t: performance.now(), node: (e.composedPath && e.composedPath()[0]) || e.target };
      },
      { capture: true, passive: true }
    );
  }

  const CONTROL_ROLES = /^(button|menuitem|menuitemcheckbox|menuitemradio|option|switch|tab|checkbox|radio|slider|link)$/;
  const CONTROL_LABEL = /full.?screen|exit|close|minimi[sz]e|restore|collapse/i;

  // True when the node (or a close ancestor) is a real control, such as the
  // player's own "exit fullscreen" button. Clicking the video itself is not.
  function isControl(node) {
    for (let n = node, depth = 0; n && depth < 10; n = flatParent(n), depth++) {
      if (!(n instanceof Element)) continue;
      if (isVideo(n) || n === state.target || n === state.overlay) return false;
      const tag = n.tagName;
      if (tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "SELECT" || tag === "LABEL" || tag === "SUMMARY") return true;
      const role = n.getAttribute("role");
      if (role && CONTROL_ROLES.test(role)) return true;
      const label = (n.getAttribute("aria-label") || "") + " " + (n.getAttribute("title") || "");
      if (CONTROL_LABEL.test(label)) return true;
      const cls = typeof n.className === "string" ? n.className : "";
      if (/fullscreen|full-screen/i.test(cls)) return true;
    }
    return false;
  }

  function shouldIgnorePageExit() {
    if (!settings.clickProtection || state.kind === "frame") return false;
    if (lastKey > lastPointer.t) return false; // a key press (e.g. the site's "f" shortcut) came last
    if (performance.now() - lastPointer.t > CLICK_WINDOW_MS) return false;
    return !isControl(lastPointer.node);
  }

  // A link wrapping the whole player (common in social feeds) would navigate
  // away on click. Cancel just the default action; player handlers still run.
  window.addEventListener(
    "click",
    (e) => {
      if (!state.active || !settings.clickProtection || state.kind !== "self" || e.button !== 0) return;
      const path = e.composedPath();
      if (!path.includes(state.target)) return;
      for (const n of path) {
        if (n instanceof HTMLAnchorElement && n.href && n.contains(state.target)) {
          e.preventDefault();
          return;
        }
      }
    },
    true
  );

  // ---------------------------------------------------------------------------
  // Preferred video quality (e.g. 1080p) when a video goes windowed
  //
  // There is no standard API for this, so each supported player gets an
  // adapter: find(video) -> player, levels(player) -> [{id, height}],
  // set(player, level). If the player doesn't offer the preferred height,
  // nothing is changed and the site's own choice stays.
  // ---------------------------------------------------------------------------

  const hlsInstances = new Set();
  let qualityTimer = 0;

  // hls.js has no instance registry. Wrap the global constructor when the
  // site's bundle assigns window.Hls, so new players are tracked.
  (function hookHls() {
    let current;
    const wrap = (H) => {
      if (typeof H !== "function" || H.__wvfsWrapped) return H;
      try {
        class Hls extends H {
          constructor(...args) {
            super(...args);
            hlsInstances.add(this);
            const destroy = this.destroy;
            if (typeof destroy === "function") {
              this.destroy = function () {
                hlsInstances.delete(this);
                return destroy.apply(this, arguments);
              };
            }
          }
        }
        Object.defineProperty(Hls, "__wvfsWrapped", { value: true });
        return Hls;
      } catch (_) {
        return H;
      }
    };
    try {
      const existing = window.Hls;
      Object.defineProperty(window, "Hls", {
        configurable: true,
        enumerable: false,
        get() {
          return current;
        },
        set(v) {
          current = wrap(v);
        }
      });
      if (existing) current = wrap(existing);
    } catch (_) {}
  })();

  const YT_HEIGHTS = { highres: 4320, hd2160: 2160, hd1440: 1440, hd1080: 1080, hd720: 720, large: 480, medium: 360, small: 240, tiny: 144 };

  function closestUp(node, test) {
    for (let n = node; n; n = flatParent(n)) if (n instanceof Element && test(n)) return n;
    return null;
  }

  const qualityAdapters = [
    {
      name: "youtube",
      find: (video) =>
        closestUp(video, (n) => n.classList.contains("html5-video-player") && typeof n.getAvailableQualityLevels === "function"),
      levels: (p) => (p.getAvailableQualityLevels() || []).filter((q) => YT_HEIGHTS[q]).map((q) => ({ id: q, height: YT_HEIGHTS[q] })),
      set: (p, l) => {
        if (typeof p.setPlaybackQualityRange === "function") p.setPlaybackQualityRange(l.id, l.id);
        if (typeof p.setPlaybackQuality === "function") p.setPlaybackQuality(l.id);
      }
    },
    {
      name: "jwplayer",
      find: (video) => {
        if (typeof window.jwplayer !== "function") return null;
        const box = closestUp(video, (n) => n.classList.contains("jwplayer") && !!n.id);
        const p = box && window.jwplayer(box.id);
        return p && typeof p.getQualityLevels === "function" ? p : null;
      },
      levels: (p) =>
        (p.getQualityLevels() || []).map((q, i) => ({ id: i, height: q.height || parseInt(q.label, 10) || 0 })),
      set: (p, l) => p.setCurrentQuality(l.id)
    },
    {
      name: "videojs",
      find: (video) => {
        const vjs = window.videojs;
        if (!vjs || typeof vjs.getPlayers !== "function") return null;
        for (const p of Object.values(vjs.getPlayers() || {})) {
          if (p && typeof p.el === "function" && p.el() && p.el().contains(video) && typeof p.qualityLevels === "function") return p;
        }
        return null;
      },
      levels: (p) => {
        const ql = p.qualityLevels();
        const out = [];
        for (let i = 0; i < ql.length; i++) out.push({ id: i, height: ql[i].height });
        return out;
      },
      set: (p, l) => {
        const ql = p.qualityLevels();
        for (let i = 0; i < ql.length; i++) ql[i].enabled = ql[i].height === l.height;
      }
    },
    {
      name: "hls.js",
      find: (video) => {
        for (const h of hlsInstances) if (h.media === video) return h;
        return null;
      },
      levels: (h) => (h.levels || []).map((lv, i) => ({ id: i, height: lv.height })),
      set: (h, l) => {
        h.nextLevel = l.id;
      }
    }
  ];

  // Returns "set" | "unavailable" | "pending" (player or its levels not ready yet).
  function trySetQuality(video, want) {
    for (const a of qualityAdapters) {
      let p = null;
      try {
        p = a.find(video);
      } catch (_) {}
      if (!p) continue;
      let levels = [];
      try {
        levels = a.levels(p);
      } catch (_) {}
      if (!levels.length) return "pending";
      const match = levels.find((l) => l.height === want);
      if (!match) return "unavailable";
      try {
        a.set(p, match);
        return "set";
      } catch (_) {
        return "unavailable";
      }
    }
    return "pending";
  }

  function applyQuality(video) {
    clearTimeout(qualityTimer);
    const want = parseInt(settings.quality, 10);
    if (!want || !video) return;
    let tries = 0;
    const attempt = () => {
      if (!state.active) return;
      if (trySetQuality(video, want) !== "pending") return;
      if (++tries < 6) qualityTimer = setTimeout(attempt, 600 * tries); // players load levels late
    };
    attempt();
  }

  // ---------------------------------------------------------------------------
  // Patch the Fullscreen API
  // ---------------------------------------------------------------------------

  function makeRequest(nativeFn) {
    return function requestFullscreen() {
      if (!isEnabled()) {
        if (typeof nativeFn === "function") return nativeFn.apply(this, arguments);
        return Promise.reject(new TypeError("Fullscreen is not supported"));
      }
      enter(this, "self");
      return Promise.resolve();
    };
  }

  function makeExit(nativeFn) {
    return function exitFullscreen() {
      if (state.active && this === document) {
        if (!shouldIgnorePageExit()) exit("page");
        return Promise.resolve();
      }
      if (typeof nativeFn === "function") return nativeFn.apply(this, arguments);
      return Promise.resolve();
    };
  }

  function patchMethod(proto, name, fn) {
    try {
      Object.defineProperty(proto, name, { configurable: true, writable: true, enumerable: true, value: fn });
    } catch (_) {}
  }

  patchMethod(ElementProto, "requestFullscreen", makeRequest(native.request));
  patchMethod(ElementProto, "webkitRequestFullscreen", makeRequest(native.webkitRequest || native.request));
  patchMethod(ElementProto, "webkitRequestFullScreen", makeRequest(native.webkitRequestCaps || native.request));
  if (native.mozRequest) patchMethod(ElementProto, "mozRequestFullScreen", makeRequest(native.mozRequest));
  if (native.videoEnter) patchMethod(VideoProto, "webkitEnterFullscreen", makeRequest(native.videoEnter));
  if (native.videoEnterCaps) patchMethod(VideoProto, "webkitEnterFullScreen", makeRequest(native.videoEnterCaps));

  patchMethod(DocProto, "exitFullscreen", makeExit(native.exit));
  patchMethod(DocProto, "webkitExitFullscreen", makeExit(native.webkitExit || native.exit));
  patchMethod(DocProto, "webkitCancelFullScreen", makeExit(native.webkitCancel || native.exit));
  if (native.mozCancel) patchMethod(DocProto, "mozCancelFullScreen", makeExit(native.mozCancel));

  function patchGetter(name, fn) {
    const orig = nativeGetter(name);
    try {
      Object.defineProperty(DocProto, name, {
        configurable: true,
        enumerable: true,
        get() {
          return fn.call(this, orig);
        }
      });
    } catch (_) {}
  }

  const elementGetter = function (orig) {
    if (state.active && this === document) return state.element;
    return orig ? orig.call(this) : null;
  };
  const booleanGetter = function (orig) {
    if (state.active && this === document) return true;
    return orig ? orig.call(this) : false;
  };
  const enabledGetter = function (orig) {
    if (isEnabled()) return true;
    return orig ? orig.call(this) : false;
  };

  patchGetter("fullscreenElement", elementGetter);
  patchGetter("webkitFullscreenElement", elementGetter);
  patchGetter("webkitCurrentFullScreenElement", elementGetter);
  patchGetter("fullscreen", booleanGetter);
  patchGetter("webkitIsFullScreen", booleanGetter);
  patchGetter("fullscreenEnabled", enabledGetter);
  patchGetter("webkitFullscreenEnabled", enabledGetter);
  if (native.mozRequest) {
    patchGetter("mozFullScreenElement", elementGetter);
    patchGetter("mozFullScreen", booleanGetter);
    patchGetter("mozFullScreenEnabled", enabledGetter);
  }

  // Built-in <video controls> fullscreen buttons (and Firefox's double-click)
  // go straight to the browser, bypassing the JS API. Catch the real
  // fullscreen and turn it into windowed fullscreen.
  function onNativeChange(e) {
    if (!e.isTrusted || !settings.convertNative || !isEnabled()) return;
    const el = nativeFullscreenElement();
    if (!isVideo(el)) return;
    const done = () => enter(el, "self");
    try {
      const p = (native.exit || native.webkitExit || native.mozCancel).call(document);
      if (p && typeof p.then === "function") p.then(done, done);
      else done();
    } catch (_) {
      done();
    }
  }
  document.addEventListener("fullscreenchange", onNativeChange, true);
  document.addEventListener("webkitfullscreenchange", (e) => {
    if (!native.request) onNativeChange(e); // only for engines without the unprefixed event
  }, true);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts (configured on the options page)
  // ---------------------------------------------------------------------------

  function matches(binding, e) {
    return (
      !!binding &&
      binding.code === e.code &&
      !!binding.ctrl === e.ctrlKey &&
      !!binding.alt === e.altKey &&
      !!binding.shift === e.shiftKey &&
      !!binding.meta === e.metaKey
    );
  }

  function isTyping(e) {
    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!(t instanceof Element)) return false;
    if (t.isContentEditable) return true;
    if (t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
    if (t.tagName === "INPUT") {
      const type = (t.getAttribute("type") || "text").toLowerCase();
      return !/^(button|checkbox|radio|range|reset|submit|image|color|file)$/.test(type);
    }
    return false;
  }

  function consume(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  window.addEventListener(
    "keydown",
    (e) => {
      lastKey = performance.now();
      if (e.isComposing || !e.code) return;
      const sc = settings.shortcuts || {};
      if (state.active && (sc.exit || []).some((b) => matches(b, e))) {
        consume(e);
        exit("user");
        return;
      }
      if ((sc.toggle || []).some((b) => matches(b, e))) {
        if (!state.active && !isEnabled()) return;
        if (settings.ignoreWhileTyping && isTyping(e)) return;
        consume(e);
        toggle();
      }
    },
    true
  );

  // ---------------------------------------------------------------------------
  // Frame protocol (window.postMessage)
  //
  // child -> parent: hello | child-enter | child-exit
  // parent -> child: state {disabled} | parent-exit | toggle
  // ---------------------------------------------------------------------------

  function postTo(win, msg) {
    try {
      win.postMessage(Object.assign({ [MSG_KEY]: 1 }, msg), "*");
    } catch (_) {}
  }

  function broadcastState() {
    const disabled = !isEnabled();
    for (const f of document.querySelectorAll("iframe, frame")) {
      if (f.contentWindow) postTo(f.contentWindow, { type: "state", disabled });
    }
  }

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || typeof d !== "object" || d[MSG_KEY] !== 1 || typeof d.type !== "string") return;
    const fromParent = !isTop && e.source === window.parent;

    switch (d.type) {
      case "hello":
        if (e.source) postTo(e.source, { type: "state", disabled: !isEnabled() });
        break;
      case "child-enter": {
        if (!isEnabled()) break;
        const frame = frameElementFor(e.source);
        if (frame) enter(frame, "frame", e.source);
        break;
      }
      case "child-exit":
        if (state.active && state.kind === "frame" && state.childWin === e.source) exit("child");
        break;
      case "parent-exit":
        if (fromParent && state.active) {
          state.toldParent = false;
          exit("parent");
        }
        break;
      case "toggle":
        if (fromParent) toggle();
        break;
      case "state":
        if (fromParent) {
          const was = isEnabled();
          parentDisabled = !!d.disabled;
          if (was !== isEnabled()) onEnabledChanged();
        }
        break;
    }
  });

  function onEnabledChanged() {
    if (!isEnabled() && state.active) exit("disabled");
    broadcastState();
  }

  // ---------------------------------------------------------------------------
  // Bridge (isolated world) communication
  // ---------------------------------------------------------------------------

  document.addEventListener(EV_SETTINGS, (e) => {
    if (typeof e.detail !== "string") return;
    let next;
    try {
      next = JSON.parse(e.detail);
    } catch (_) {
      return;
    }
    if (!next || typeof next !== "object") return;
    const was = isEnabled();
    settings = Object.assign({}, settings, next);
    if (was !== isEnabled()) onEnabledChanged();
    else broadcastState();
  });

  document.addEventListener(EV_COMMAND, (e) => {
    if (e.detail === "toggle") toggle();
    else if (e.detail === "exit") exit("user");
  });

  document.addEventListener(EV_QUERY, () => {
    document.dispatchEvent(
      new CustomEvent(EV_STATE, {
        detail: JSON.stringify({ active: state.active, enabled: isEnabled(), hasVideo: !!pickVideo() || !!pickFrame() })
      })
    );
  });

  document.dispatchEvent(new CustomEvent(EV_HELLO));
  if (!isTop) postTo(window.parent, { type: "hello" });
})();
