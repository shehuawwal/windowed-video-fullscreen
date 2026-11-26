# Windowed Video Fullscreen

A browser extension that makes video "fullscreen" fill the **browser tab** instead of your whole screen, on every website. Keep your tabs, toolbars, other windows and second monitor usable while a video plays at full tab size.

Works in Chrome, Edge, Brave, Opera, Vivaldi, Arc and Firefox. Safari works through Apple's converter (not yet tested).

## Features

- **Every site.** The site's own fullscreen button, the browser's built-in video controls, and embedded players (iframes) all go windowed.
- **Your shortcuts.** Set any key combination to toggle or exit, and more than one per action. Defaults: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> to toggle, <kbd>Esc</kbd> to exit.
- **Click-safe.** Clicking or double-clicking the video doesn't throw you out of windowed fullscreen, and links wrapped around a player don't navigate away. The player's own exit button still works.
- **Keeps site controls.** The player stays in the page, so play/pause, the timeline and captions keep working.
- **Per-site off switch** from the toolbar button, plus an off switch for all sites.
- **Private.** No network requests, no analytics. The only permission is `storage`, for your settings. All-sites access is needed to run on every video page.

## Install a release

Download from the [latest release](https://github.com/shehuawwal/windowed-video-fullscreen/releases/latest):

- **Firefox:** open the `…-firefox-signed.xpi` file in Firefox to install it permanently.
- **Chrome, Edge, Brave, Opera, Vivaldi, Arc:** unzip `…-chrome.zip`, then follow the Chrome steps below and pick the unzipped folder.

## Install from source

You need `bash`, `zip` and `jq`, which macOS and most Linux systems include.

```sh
git clone https://github.com/shehuawwal/windowed-video-fullscreen.git
cd windowed-video-fullscreen
./scripts/build.sh
```

This creates `dist/chrome/` and `dist/firefox/` (plus zips).

**Chrome, Edge, Brave, Opera, Vivaldi, Arc**

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick the `dist/chrome` folder.

**Firefox (128 or newer)**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `dist/firefox/manifest.json`.

Firefox removes temporary add-ons when it restarts. For a permanent install, sign the zip on [addons.mozilla.org](https://addons.mozilla.org/developers/) (an unlisted listing is fine).

**Safari (macOS, Xcode required)**

```sh
./scripts/safari.sh
```

Open the generated Xcode project in `dist/safari`, run it, then enable the extension in Safari ▸ Settings ▸ Extensions. You'll need **Develop ▸ Allow Unsigned Extensions**.

## Use

- Press the video's fullscreen button as usual. It fills the tab.
- Or press your toggle shortcut (default <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd>). It picks the playing video, or the largest visible one.
- Or click the toolbar button and choose **Toggle windowed fullscreen**.
- Exit with <kbd>Esc</kbd>, your toggle shortcut, or the player's exit button.

Press <kbd>F11</kbd> (macOS: <kbd>Ctrl</kbd> + <kbd>Cmd</kbd> + <kbd>F</kbd>) first if you want the tab itself to cover the screen.

### Settings

Right-click the toolbar icon and choose **Options** (Firefox: **Manage Extension ▸ Preferences**), or use **Shortcuts & settings** in the popup.

| Setting | Default | What it does |
|---|---|---|
| Keyboard shortcuts | Ctrl+Shift+F / Esc | Click **Add shortcut**, press keys. Remove with ×. |
| On for all sites | on | Off restores real fullscreen everywhere. |
| Clicking the video never exits | on | Ignores exit requests caused by clicking the video, and stops wrapping links from navigating. |
| Also catch built-in video controls | on | Turns real fullscreen from plain `<video controls>` into windowed. You may see a brief flash. |
| Ignore the toggle shortcut while typing | on | Keeps single-key shortcuts from firing in text boxes. |
| Layout method | In place | **Overlay** moves the player into a black layer. Try it if a site's player ends up misplaced. |
| Sites where it's off | none | These sites keep real fullscreen. A domain covers its subdomains. |

## Known limits

- The browser keeps some shortcuts for itself (for example new tab or close tab). Pages can't see them, so they can't be used.
- Sites that style their player with the `:fullscreen` CSS selector won't get those styles, because the browser isn't really in fullscreen.
- DRM or plugin players that skip the standard Fullscreen API may still go fully fullscreen.
- Extensions can't run on browser pages (`chrome://`, `about:`) or extension stores.

If a player acts oddly, press <kbd>Esc</kbd>, reload the page, try the **Overlay** layout, or switch the site off from the toolbar button. Please [open an issue](https://github.com/shehuawwal/windowed-video-fullscreen/issues) with the site's URL.

## Develop

```sh
node --test tests/*.test.mjs          # unit tests (settings logic)
tests/run-harness.sh        # behaviour tests in headless Chrome
./scripts/build.sh          # build every browser
python3 -m http.server      # then open http://localhost:8000/demo/ to test by hand
```

See [AGENTS.md](AGENTS.md) for the architecture and contribution rules, and [docs/PLAN.md](docs/PLAN.md) for the roadmap.

## License

[MIT](LICENSE)
