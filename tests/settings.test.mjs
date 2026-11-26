// Unit tests for src/shared/settings.js. Run: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const WVFS = createRequire(import.meta.url)("../src/shared/settings.js");

test("merge falls back to defaults", () => {
  const s = WVFS.merge(undefined);
  assert.equal(s.enabled, true);
  assert.equal(s.mode, "inplace");
  assert.equal(s.clickProtection, true);
  assert.deepEqual(s.shortcuts.toggle.map((b) => b.code), ["KeyF"]);
  assert.deepEqual(s.shortcuts.exit.map((b) => b.code), ["Escape"]);
});

test("merge does not share objects with DEFAULTS", () => {
  const s = WVFS.merge({});
  s.shortcuts.toggle.push({ code: "KeyX" });
  assert.equal(WVFS.DEFAULTS.shortcuts.toggle.length, 1);
});

test("merge keeps valid values and drops malformed ones", () => {
  const s = WVFS.merge({
    enabled: false,
    mode: "bogus",
    clickProtection: "yes",
    shortcuts: { toggle: [{ code: "KeyG", alt: 1 }, { code: "ShiftLeft" }, null, { nope: true }], exit: [] },
    disabledSites: ["https://www.YouTube.com/watch?v=1", "", "youtube.com", "Example.org."]
  });
  assert.equal(s.enabled, false);
  assert.equal(s.mode, "inplace");
  assert.equal(s.clickProtection, true);
  assert.deepEqual(s.shortcuts.toggle, [{ code: "KeyG", key: "", ctrl: false, shift: false, alt: true, meta: false }]);
  assert.deepEqual(s.shortcuts.exit, []);
  assert.deepEqual(s.disabledSites, ["youtube.com", "example.org"]);
});

test("hostDisabled matches domains and subdomains only", () => {
  const list = ["example.com"];
  assert.equal(WVFS.hostDisabled("example.com", list), true);
  assert.equal(WVFS.hostDisabled("www.example.com", list), true);
  assert.equal(WVFS.hostDisabled("video.example.com", list), true);
  assert.equal(WVFS.hostDisabled("notexample.com", list), false);
  assert.equal(WVFS.hostDisabled("", list), false);
});

test("bindingLabel is readable on each platform", () => {
  const b = { code: "KeyF", ctrl: true, shift: true, alt: false, meta: false };
  assert.equal(WVFS.bindingLabel(b, false), "Ctrl + Shift + F");
  assert.equal(WVFS.bindingLabel(b, true), "Control + Shift + F");
  assert.equal(WVFS.bindingLabel({ code: "Escape" }, false), "Esc");
  assert.equal(WVFS.bindingLabel({ code: "Digit1", alt: true, meta: true }, true), "Option + Cmd + 1");
  assert.equal(WVFS.bindingLabel({ code: "IntlRo", key: "ろ" }, false), "ろ");
});

test("bindingFromEvent ignores bare modifiers", () => {
  assert.equal(WVFS.bindingFromEvent({ code: "ControlLeft", key: "Control", ctrlKey: true }), null);
  assert.deepEqual(WVFS.bindingFromEvent({ code: "KeyK", key: "k", ctrlKey: false, shiftKey: false, altKey: true, metaKey: false }), {
    code: "KeyK", key: "k", ctrl: false, shift: false, alt: true, meta: false
  });
});

test("sameBinding compares code and modifiers", () => {
  assert.equal(WVFS.sameBinding({ code: "KeyF", ctrl: true }, { code: "KeyF", ctrl: true, key: "f" }), true);
  assert.equal(WVFS.sameBinding({ code: "KeyF", ctrl: true }, { code: "KeyF" }), false);
});

test("forPage hides the site list and resolves the current host", () => {
  const s = WVFS.merge({ disabledSites: ["x.com"] });
  const p = WVFS.forPage(s, "x.com");
  assert.equal(p.siteDisabled, true);
  assert.equal("disabledSites" in p, false);
  assert.equal(WVFS.forPage(s, "youtube.com").siteDisabled, false);
});
