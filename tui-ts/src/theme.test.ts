import { describe, test, expect, afterEach } from "bun:test";

const origPulseTheme = process.env.PULSE_THEME;
delete process.env.PULSE_THEME;
process.env.XDG_STATE_HOME = "/tmp/pulse-theme-test-nonexistent";

const { getTheme } = await import("./theme.ts");

describe("getTheme", () => {
  afterEach(() => {
    if (origPulseTheme !== undefined) {
      process.env.PULSE_THEME = origPulseTheme;
    } else {
      delete process.env.PULSE_THEME;
    }
  });

  test("returns opencode theme by default (no env override)", () => {
    delete process.env.PULSE_THEME;
    const theme = getTheme();
    expect(theme.primary).toBe("#fab283");
    expect(theme.accent).toBe("#9d7cd8");
    expect(theme.error).toBe("#e06c75");
  });

  test("respects PULSE_THEME env var", () => {
    process.env.PULSE_THEME = "dracula";
    const theme = getTheme();
    expect(theme.primary).toBe("#bd93f9");
    expect(theme.accent).toBe("#8be9fd");
    expect(theme.error).toBe("#ff5555");
  });

  test("falls back to opencode for unknown theme name", () => {
    process.env.PULSE_THEME = "nonexistent-theme-name";
    const theme = getTheme();
    expect(theme.primary).toBe("#fab283");
  });

  test("all 33 themes have valid hex colors for all fields", () => {
    const themeNames = [
      "aura", "ayu", "carbonfox", "catppuccin", "catppuccin-frappe",
      "catppuccin-macchiato", "cobalt2", "cursor", "dracula", "everforest",
      "flexoki", "github", "gruvbox", "kanagawa", "lucent-orng", "material",
      "matrix", "mercury", "monokai", "nightowl", "nord", "one-dark",
      "opencode", "orng", "osaka-jade", "palenight", "rosepine", "solarized",
      "synthwave84", "tokyonight", "vercel", "vesper", "zenburn",
    ];

    for (const name of themeNames) {
      process.env.PULSE_THEME = name;
      const theme = getTheme();
      expect(theme.primary).toBeTruthy();
      expect(theme.accent).toBeTruthy();
      expect(theme.error).toBeTruthy();
      expect(theme.warning).toBeTruthy();
      expect(theme.success).toBeTruthy();
      expect(theme.info).toBeTruthy();
      expect(theme.text).toBeTruthy();
      expect(theme.textMuted).toBeTruthy();
      expect(theme.primary).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });

  test("catppuccin variants are distinct themes", () => {
    process.env.PULSE_THEME = "catppuccin";
    const cat = getTheme();
    process.env.PULSE_THEME = "catppuccin-frappe";
    const frappe = getTheme();
    process.env.PULSE_THEME = "catppuccin-macchiato";
    const macchiato = getTheme();

    expect(cat.primary).not.toBe(frappe.primary);
    expect(cat.primary).not.toBe(macchiato.primary);
    expect(frappe.primary).not.toBe(macchiato.primary);
  });
});
