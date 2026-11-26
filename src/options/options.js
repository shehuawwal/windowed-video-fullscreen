(() => {
  "use strict";
  const api = globalThis.browser || globalThis.chrome;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const $ = (sel, root = document) => root.querySelector(sel);

  let settings = WVFS.merge({});
  let recording = null; // { action, button }
  let savedTimer = 0;

  async function save(patch) {
    Object.assign(settings, patch);
    await api.storage.sync.set(patch);
    const el = $("#saved");
    el.textContent = "Saved";
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (el.textContent = ""), 1500);
  }

  // ---- Shortcuts -----------------------------------------------------------

  function renderShortcuts() {
    for (const box of document.querySelectorAll(".action")) {
      const action = box.dataset.action;
      const list = $(".bindings", box);
      list.replaceChildren();
      const bindings = settings.shortcuts[action];
      if (!bindings.length) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = action === "exit" ? "No shortcut (use the toggle shortcut or the player's button)" : "No shortcut";
        list.append(li);
      }
      bindings.forEach((b, i) => {
        const li = document.createElement("li");
        const k = document.createElement("kbd");
        k.textContent = WVFS.bindingLabel(b, isMac);
        const rm = document.createElement("button");
        rm.className = "remove";
        rm.textContent = "×";
        rm.title = "Remove";
        rm.setAttribute("aria-label", "Remove " + k.textContent);
        rm.addEventListener("click", () => {
          const next = structuredClone(settings.shortcuts);
          next[action].splice(i, 1);
          save({ shortcuts: next }).then(renderShortcuts);
        });
        li.append(k, rm);
        list.append(li);
      });
    }
    renderWarning();
  }

  function renderWarning() {
    const msgs = [];
    const { toggle, exit } = settings.shortcuts;
    for (const t of toggle) {
      if (exit.some((x) => WVFS.sameBinding(x, t))) {
        msgs.push(`${WVFS.bindingLabel(t, isMac)} is set for both actions; it will exit while a video is windowed and toggle otherwise.`);
      }
      if (!t.ctrl && !t.alt && !t.meta && /^(Key|Digit)/.test(t.code)) {
        msgs.push(`${WVFS.bindingLabel(t, isMac)} has no Ctrl/Alt/${isMac ? "Cmd" : "Win"} key, so it may clash with a site's own shortcuts (YouTube uses F for fullscreen).`);
      }
    }
    if (!toggle.length) msgs.push("There is no toggle shortcut. You can still use the toolbar button.");
    const w = $("#warning");
    w.hidden = !msgs.length;
    w.textContent = msgs.join(" ");
  }

  function stopRecording() {
    if (!recording) return;
    recording.button.classList.remove("recording");
    recording.button.textContent = "Add shortcut";
    recording = null;
  }

  for (const box of document.querySelectorAll(".action")) {
    const button = $(".add", box);
    button.addEventListener("click", () => {
      const same = recording && recording.button === button;
      stopRecording();
      if (same) return;
      recording = { action: box.dataset.action, button };
      button.classList.add("recording");
      button.textContent = "Press keys… (click to cancel)";
    });
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (!recording) return;
      // Tab alone keeps moving focus so keyboard users aren't trapped.
      if (e.code === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        stopRecording();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const b = WVFS.bindingFromEvent(e);
      if (!b) return; // modifier on its own: keep waiting
      const { action } = recording;
      stopRecording();
      const next = structuredClone(settings.shortcuts);
      if (!next[action].some((x) => WVFS.sameBinding(x, b))) next[action].push(b);
      save({ shortcuts: next }).then(renderShortcuts);
    },
    true
  );

  $("#reset-shortcuts").addEventListener("click", () => {
    stopRecording();
    save({ shortcuts: structuredClone(WVFS.DEFAULTS.shortcuts) }).then(renderShortcuts);
  });

  // ---- Behaviour -----------------------------------------------------------

  for (const key of ["enabled", "clickProtection", "convertNative", "ignoreWhileTyping"]) {
    $("#" + key).addEventListener("change", (e) => save({ [key]: e.target.checked }));
  }
  $("#quality").addEventListener("change", (e) => save({ quality: e.target.value }));
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener("change", (e) => e.target.checked && save({ mode: e.target.value }));
  }

  function renderBehaviour() {
    for (const key of ["enabled", "clickProtection", "convertNative", "ignoreWhileTyping"]) $("#" + key).checked = settings[key];
    for (const radio of document.querySelectorAll('input[name="mode"]')) radio.checked = radio.value === settings.mode;
    $("#quality").value = settings.quality;
  }

  // ---- Sites ---------------------------------------------------------------

  function renderSites() {
    const list = $("#sites");
    list.replaceChildren();
    for (const host of settings.disabledSites) {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = host;
      const rm = document.createElement("button");
      rm.className = "remove";
      rm.textContent = "×";
      rm.setAttribute("aria-label", "Turn back on for " + host);
      rm.title = "Turn back on";
      rm.addEventListener("click", () => {
        save({ disabledSites: settings.disabledSites.filter((h) => h !== host) }).then(renderSites);
      });
      li.append(span, rm);
      list.append(li);
    }
    $("#no-sites").hidden = settings.disabledSites.length > 0;
  }

  $("#add-site").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#site-input");
    const host = WVFS.normalizeHost(input.value);
    input.value = "";
    if (!host || settings.disabledSites.includes(host)) return;
    save({ disabledSites: settings.disabledSites.concat(host) }).then(renderSites);
  });

  // ---- Init ----------------------------------------------------------------

  async function load() {
    settings = WVFS.merge(await api.storage.sync.get(null));
    renderShortcuts();
    renderBehaviour();
    renderSites();
  }

  // Stay in sync with changes made from the popup or another options tab.
  api.storage.onChanged.addListener((_c, area) => {
    if (area === "sync" && !recording) load();
  });

  $("#version").textContent = "Version " + api.runtime.getManifest().version;
  load();
})();
