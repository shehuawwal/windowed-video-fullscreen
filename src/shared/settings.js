/*
 * Shared settings helpers for the extension's own pages and the bridge
 * content script (isolated world). Loaded as a classic script; exposes a
 * single global `WVFS`. Not loaded into the page's MAIN world.
 */
// eslint-disable-next-line no-unused-vars
var WVFS = (() => {
  "use strict";

  const DEFAULTS = Object.freeze({
    enabled: true,
    mode: "inplace", // "inplace" | "overlay"
    clickProtection: true,
    convertNative: true,
    ignoreWhileTyping: true,
    quality: "1080", // preferred height when a video goes windowed; "" = keep the site's choice
    shortcuts: {
      toggle: [{ code: "KeyF", key: "F", ctrl: true, shift: true, alt: false, meta: false }],
      exit: [{ code: "Escape", key: "Escape", ctrl: false, shift: false, alt: false, meta: false }]
    },
    disabledSites: []
  });

  const QUALITIES = ["", "2160", "1440", "1080", "720", "480", "360"];

  const MODIFIER_CODES = new Set([
    "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight",
    "MetaLeft", "MetaRight", "OSLeft", "OSRight", "CapsLock", "Fn", "FnLock"
  ]);

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function validBinding(b) {
    return !!b && typeof b === "object" && typeof b.code === "string" && b.code.length > 0 && !MODIFIER_CODES.has(b.code);
  }

  function normalizeBinding(b) {
    return {
      code: b.code,
      key: typeof b.key === "string" ? b.key : "",
      ctrl: !!b.ctrl,
      shift: !!b.shift,
      alt: !!b.alt,
      meta: !!b.meta
    };
  }

  function normalizeHost(h) {
    return String(h || "")
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
      .replace(/[/?#:].*$/, "")
      .replace(/^www\./, "")
      .replace(/\.$/, "");
  }

  // Merge whatever is in storage with the defaults, dropping anything malformed.
  function merge(stored) {
    const s = stored && typeof stored === "object" ? stored : {};
    const out = clone(DEFAULTS);
    for (const k of ["enabled", "clickProtection", "convertNative", "ignoreWhileTyping"]) {
      if (typeof s[k] === "boolean") out[k] = s[k];
    }
    if (s.mode === "inplace" || s.mode === "overlay") out.mode = s.mode;
    if (typeof s.quality === "string" && QUALITIES.includes(s.quality)) out.quality = s.quality;
    if (s.shortcuts && typeof s.shortcuts === "object") {
      for (const action of ["toggle", "exit"]) {
        if (Array.isArray(s.shortcuts[action])) {
          out.shortcuts[action] = s.shortcuts[action].filter(validBinding).map(normalizeBinding);
        }
      }
    }
    if (Array.isArray(s.disabledSites)) {
      out.disabledSites = Array.from(new Set(s.disabledSites.map(normalizeHost).filter(Boolean)));
    }
    return out;
  }

  // "example.com" in the list also disables "video.example.com".
  function hostDisabled(host, list) {
    const h = normalizeHost(host);
    if (!h) return false;
    return (list || []).some((d) => h === d || h.endsWith("." + d));
  }

  function sameBinding(a, b) {
    return a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.meta === !!b.meta;
  }

  const CODE_NAMES = {
    Escape: "Esc", Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Backquote: "`", Minus: "-", Equal: "=",
    BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",",
    Period: ".", Slash: "/", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert"
  };

  function keyName(b) {
    const c = b.code;
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit[0-9]$/.test(c)) return c.slice(5);
    if (/^Numpad/.test(c)) return "Num " + c.slice(6);
    if (/^F[0-9]{1,2}$/.test(c)) return c;
    if (CODE_NAMES[c]) return CODE_NAMES[c];
    return b.key && b.key.length === 1 ? b.key.toUpperCase() : c;
  }

  function bindingLabel(b, isMac) {
    const parts = [];
    if (b.ctrl) parts.push(isMac ? "Control" : "Ctrl");
    if (b.alt) parts.push(isMac ? "Option" : "Alt");
    if (b.shift) parts.push("Shift");
    if (b.meta) parts.push(isMac ? "Cmd" : "Win");
    parts.push(keyName(b));
    return parts.join(" + ");
  }

  function bindingFromEvent(e) {
    if (!e.code || MODIFIER_CODES.has(e.code)) return null;
    return normalizeBinding({ code: e.code, key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
  }

  // Settings shape handed to page.js (the page world never sees the site list).
  function forPage(settings, host) {
    return {
      enabled: settings.enabled,
      siteDisabled: hostDisabled(host, settings.disabledSites),
      mode: settings.mode,
      clickProtection: settings.clickProtection,
      convertNative: settings.convertNative,
      ignoreWhileTyping: settings.ignoreWhileTyping,
      quality: settings.quality,
      shortcuts: settings.shortcuts
    };
  }

  return {
    DEFAULTS,
    QUALITIES,
    MODIFIER_CODES,
    merge,
    normalizeHost,
    hostDisabled,
    sameBinding,
    bindingLabel,
    bindingFromEvent,
    forPage
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WVFS;
