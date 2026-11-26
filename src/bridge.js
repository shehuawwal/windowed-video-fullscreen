/*
 * Bridge content script (isolated world, every frame, document_start).
 *
 * Reads settings from extension storage and hands them to page.js (MAIN world)
 * as a JSON string on a CustomEvent. Relays popup commands to page.js.
 * Never writes storage on behalf of the page: page events can be forged.
 */
(() => {
  "use strict";
  const api = globalThis.browser || globalThis.chrome;
  if (!api || !api.storage) return;

  const host = location.hostname;
  let current = null;

  function send() {
    if (!current) return;
    document.dispatchEvent(new CustomEvent("wvfs:settings", { detail: JSON.stringify(WVFS.forPage(current, host)) }));
  }

  function load() {
    api.storage.sync.get(null).then(
      (stored) => {
        current = WVFS.merge(stored);
        send();
      },
      () => {
        current = WVFS.merge({});
        send();
      }
    );
  }

  // page.js announces itself; answer in case it loaded after our first send.
  document.addEventListener("wvfs:hello", send);

  api.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync") load();
  });

  // Popup -> top frame.
  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "toggle" || msg.type === "exit") {
      document.dispatchEvent(new CustomEvent("wvfs:command", { detail: msg.type }));
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "status") {
      let pageState = null;
      const onState = (e) => {
        try {
          pageState = JSON.parse(e.detail);
        } catch (_) {}
      };
      document.addEventListener("wvfs:state", onState);
      document.dispatchEvent(new CustomEvent("wvfs:query")); // page.js answers synchronously
      document.removeEventListener("wvfs:state", onState);
      sendResponse({ host: WVFS.normalizeHost(host), page: pageState });
    }
  });

  load();
})();
