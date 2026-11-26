# Plan

## Goal

Make every video's fullscreen fill the browser tab instead of the screen, on any website, in every major browser, with shortcuts users choose. Free and open source (MIT).

## Where it started

v1.1 was a private, Firefox-only content script. It moved the player into a full-page overlay, used a fixed <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> shortcut, and kept no settings. Known problems:

- Fixed shortcut, with no way to change it.
- Clicking the video could exit windowed fullscreen. Moving the player out of the site's DOM broke click handling in React apps. Site click handlers that call `exitFullscreen()` were obeyed. When the site re-rendered the player, the observer saw it vanish and exited.
- Firefox only. The native `<video controls>` fullscreen button and iframe players weren't handled.

## Milestones

### M1: open-source 2.0 (this release)

- [x] Restructure into `src/` + per-browser manifests + `scripts/build.sh` (no build dependencies)
- [x] Chromium build (Chrome, Edge, Brave, Opera, Vivaldi, Arc) and Firefox build from one source; Safari script via `safari-web-extension-converter`
- [x] Settings page with a shortcut recorder: any combination, several per action, toggle and exit actions
- [x] Click protection: ignore click-caused exits, block wrapping links, keep the player's own exit button working
- [x] "In place" layout as the default (DOM untouched); overlay kept as an option
- [x] Re-acquire the player after a site re-render
- [x] iframe support through a postMessage frame protocol
- [x] Convert native `<video controls>` fullscreen to windowed
- [x] Toolbar popup: toggle, per-site and global on/off
- [x] Unit tests, headless-Chrome behaviour harness, manual demo page, CI with release on tag
- [ ] Manual check on real sites: YouTube, X, Vimeo, Twitch, Netflix, Facebook, Instagram, Reddit, embedded YouTube (owner, before publishing)
- [x] Make the GitHub repo public and tag v2.0.0

### M2: distribution

- Chrome Web Store listing (developer account, screenshots, privacy form that declares no data collection).
- [x] addons.mozilla.org public listing (2.1.0): metadata in `amo/`, screenshots from the demo page, CI submits each tag for review.
- Edge Add-ons listing (the Chromium zip works as-is).
- Safari: test the converted build, then decide whether App Store distribution is worth the yearly Apple developer fee.

### M3: quality

- [x] Preferred video quality when windowed (2.1.0): YouTube, JW Player, Video.js, hls.js. Next: dash.js, Shaka, an option to apply to every video, not just windowed ones.

- Per-site overrides (layout method, click protection) instead of only on/off.
- Optional browser-level shortcut through the `commands` API. It works even when focus is in the address bar, and users edit it at `chrome://extensions/shortcuts` or in Firefox's add-on manager.
- Small on-screen hint when windowed ("Esc to exit"), which can be turned off.
- Site-specific fixes where the generic method falls short. Keep them in one table in page.js, with a test page for each.
- Playwright tests that load the real extension (Chrome for Testing + Firefox) and drive the demo page, including real fullscreen buttons.
- Translations (`_locales/`).

### Ideas, not committed

- "Theater" variant: fill the tab but keep the site header visible.
- Picture-in-picture shortcut alongside windowed fullscreen.

## Design decisions

| Decision | Why |
|---|---|
| Patch the Fullscreen API in the MAIN world at `document_start` | The only way to catch every site's fullscreen call before it runs. Supported by `world: "MAIN"` in Chrome 111+ and Firefox 128+ (we require 140+, the first version with `data_collection_permissions`). |
| "In place" as the default layout | Keeps the player inside the site's DOM, so framework event handling (React's root listener) and the player's controls keep working. |
| Shortcuts handled in the page, not through the `commands` API | Allows any key, single keys and several shortcuts per action, and works the same in every browser. Trade-off: the shortcut needs focus on the page. |
| Settings passed as a JSON string on a DOM event | Crosses the isolated/MAIN world boundary in both Chrome and Firefox without `cloneInto`. |
| No background script | Nothing needs one. A smaller attack surface and no service worker lifecycle issues. |
| No bundler or npm dependencies | Reviewers (AMO in particular) read the shipped source directly, and contributors can start without installing anything. |
| `storage.sync` | Settings follow the user across devices signed into the same browser. |

## Risks

- **Site breakage:** some layouts may still misplace the player. Mitigations are the overlay mode, per-site off switch, and issue template asking for the URL.
- **Spoofed fullscreen state:** sites that check `:fullscreen` CSS or `window.innerHeight === screen.height` won't be fooled. That's acceptable; documented.
- **Store review:** all-sites access needs a clear justification in listings ("runs on every page that might have a video").
