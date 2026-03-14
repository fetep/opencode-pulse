import { describe, expect, test } from "bun:test";
import { TMUX_TARGET_RE } from "./tmux.js";

describe("TMUX_TARGET_RE", () => {
  test("accepts valid pane and session targets", () => {
    expect(TMUX_TARGET_RE.test("%1")).toBe(true);
    expect(TMUX_TARGET_RE.test("dev")).toBe(true);
    expect(TMUX_TARGET_RE.test("dev:1.2")).toBe(true);
    expect(TMUX_TARGET_RE.test("my-session")).toBe(true);
    expect(TMUX_TARGET_RE.test("@0")).toBe(true);
  });

  test("rejects targets with escape sequences or special characters", () => {
    expect(TMUX_TARGET_RE.test("\x1b[31mevil")).toBe(false);
    expect(TMUX_TARGET_RE.test("session;rm -rf /")).toBe(false);
    expect(TMUX_TARGET_RE.test("foo\x00bar")).toBe(false);
    expect(TMUX_TARGET_RE.test("")).toBe(false);
  });
});
