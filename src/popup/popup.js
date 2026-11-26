(() => {
  "use strict";
  const api = globalThis.browser || globalThis.chrome;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const $ = (id) => document.getElementById(id);

  let tabId = null;
  let host = "";
  let settings = WVFS.merge({});

  async function load() {
    settings = WVFS.merge(await api.storage.sync.get(null));
    const t = settings.shortcuts.toggle[0];
    $("shortcut").innerHTML = "";
    if (t) {
      const k = document.createElement("kbd");
      k.textContent = WVFS.bindingLabel(t, isMac);
      $("shortcut").append(k);
    } else {
      $("shortcut").textContent = "none set";
    }
    $("global").checked = settings.enabled;
    $("site").checked = !WVFS.hostDisabled(host, settings.disabledSites);
    $("site").disabled = !host;
  }

  async function status() {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab) return null;
    tabId = tab.id;
    try {
      return await api.tabs.sendMessage(tabId, { type: "status" }, { frameId: 0 });
    } catch (_) {
      return null; // browser pages, store pages, or the tab predates the install
    }
  }

  async function init() {
    const res = await status();
    if (res) {
      host = res.host || "";
      $("host").textContent = host || "this page";
      const p = res.page;
      if (!p) $("status").textContent = "Reload this tab to use the extension here.";
      else if (p.active) $("status").textContent = "A video is in windowed fullscreen.";
      else if (!p.enabled) $("status").textContent = "Turned off for this page.";
      else if (p.hasVideo) $("status").textContent = "Video found on this page.";
      else $("status").textContent = "No visible video on this page yet.";
      $("toggle").disabled = !p || (!p.active && !p.enabled);
    } else {
      $("status").textContent = "Not available on this page (browser and store pages block extensions). Try reloading the tab.";
      $("toggle").disabled = true;
    }
    await load();
  }

  $("toggle").addEventListener("click", async () => {
    if (tabId == null) return;
    try {
      await api.tabs.sendMessage(tabId, { type: "toggle" }, { frameId: 0 });
    } catch (_) {}
    window.close();
  });

  $("global").addEventListener("change", async (e) => {
    await api.storage.sync.set({ enabled: e.target.checked });
    $("reload").hidden = false;
  });

  $("site").addEventListener("change", async (e) => {
    const h = WVFS.normalizeHost(host);
    if (!h) return;
    // Remove the host and any parent domain entry that covers it.
    let list = settings.disabledSites.filter((d) => !(h === d || h.endsWith("." + d)));
    if (!e.target.checked) list = list.concat(h);
    await api.storage.sync.set({ disabledSites: list });
    settings.disabledSites = list;
    $("reload").hidden = false;
  });

  $("options").addEventListener("click", () => {
    api.runtime.openOptionsPage();
    window.close();
  });

  init();
})();
