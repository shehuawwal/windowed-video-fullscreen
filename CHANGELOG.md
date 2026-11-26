# Changelog

## 2.0.0 — 2026-11-26

First open-source release; rewrite of the private Firefox-only v1.1.

- Builds for Chrome, Edge, Brave, Opera, Vivaldi (Chromium) and Firefox from one source; Safari via Xcode converter.
- Configurable shortcuts on a settings page: several shortcuts per action, any key combination.
- Clicking or double-clicking the video no longer exits windowed fullscreen; the player's own exit button still works. Links wrapping a player no longer navigate on click.
- New "in place" layout (default): the player stays where the site put it, so site controls and click handlers keep working. The v1.1 overlay method remains as an option.
- Players re-rendered by the site stay windowed.
- Embedded players (iframes) fill the whole tab.
- Built-in `<video controls>` fullscreen is converted to windowed.
- Toolbar popup: toggle the video, switch the extension off per site or everywhere.

## 1.1.0

- Player moved into a top-level overlay to avoid offset players on X.
- Ctrl + Shift + F toggle, Escape to exit.
