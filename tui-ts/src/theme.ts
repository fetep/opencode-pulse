import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";


// Dark-mode hex values resolved from OpenCode's theme JSON files.
// Source: https://github.com/anomalyco/opencode/tree/dev/packages/opencode/src/cli/cmd/tui/context/theme/
// Each JSON has { defs: { alias: "#hex" }, theme: { slot: { dark: "alias" } } }.
// We pre-resolve theme[slot].dark → defs[alias] for the 8 semantic slots below.

export interface Theme {
  primary: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  text: string;
  textMuted: string;
}

const themes: Record<string, Theme> = {
  aura: {
    primary: "#a277ff",
    accent: "#a277ff",
    error: "#ff6767",
    warning: "#ffca85",
    success: "#61ffca",
    info: "#a277ff",
    text: "#edecee",
    textMuted: "#6d6d6d",
  },
  ayu: {
    primary: "#59C2FF",
    accent: "#E6B450",
    error: "#D95757",
    warning: "#E6B673",
    success: "#7FD962",
    info: "#39BAE6",
    text: "#BFBDB6",
    textMuted: "#565B66",
  },
  carbonfox: {
    primary: "#33b1ff",
    accent: "#ff7eb6",
    error: "#ee5396",
    warning: "#f1c21b",
    success: "#25be6a",
    info: "#78a9ff",
    text: "#f2f4f8",
    textMuted: "#7d848f",
  },
  catppuccin: {
    primary: "#89b4fa",
    accent: "#f5c2e7",
    error: "#f38ba8",
    warning: "#f9e2af",
    success: "#a6e3a1",
    info: "#94e2d5",
    text: "#cdd6f4",
    textMuted: "#bac2de",
  },
  "catppuccin-frappe": {
    primary: "#8da4e2",
    accent: "#f4b8e4",
    error: "#e78284",
    warning: "#e5c890",
    success: "#a6d189",
    info: "#81c8be",
    text: "#c6d0f5",
    textMuted: "#b5bfe2",
  },
  "catppuccin-macchiato": {
    primary: "#8aadf4",
    accent: "#f5bde6",
    error: "#ed8796",
    warning: "#eed49f",
    success: "#a6da95",
    info: "#8bd5ca",
    text: "#cad3f5",
    textMuted: "#b8c0e0",
  },
  cobalt2: {
    primary: "#0088ff",
    accent: "#2affdf",
    error: "#ff0088",
    warning: "#ffc600",
    success: "#9eff80",
    info: "#ff9d00",
    text: "#ffffff",
    textMuted: "#adb7c9",
  },
  cursor: {
    primary: "#88c0d0",
    accent: "#88c0d0",
    error: "#e34671",
    warning: "#f1b467",
    success: "#3fa266",
    info: "#81a1c1",
    text: "#e4e4e4",
    textMuted: "#e4e4e45e",
  },
  dracula: {
    primary: "#bd93f9",
    accent: "#8be9fd",
    error: "#ff5555",
    warning: "#f1fa8c",
    success: "#50fa7b",
    info: "#ffb86c",
    text: "#f8f8f2",
    textMuted: "#6272a4",
  },
  everforest: {
    primary: "#a7c080",
    accent: "#d699b6",
    error: "#e67e80",
    warning: "#e69875",
    success: "#a7c080",
    info: "#83c092",
    text: "#d3c6aa",
    textMuted: "#7a8478",
  },
  flexoki: {
    primary: "#DA702C",
    accent: "#8B7EC8",
    error: "#D14D41",
    warning: "#DA702C",
    success: "#879A39",
    info: "#3AA99F",
    text: "#CECDC3",
    textMuted: "#6F6E69",
  },
  github: {
    primary: "#58a6ff",
    accent: "#39c5cf",
    error: "#f85149",
    warning: "#e3b341",
    success: "#3fb950",
    info: "#d29922",
    text: "#c9d1d9",
    textMuted: "#8b949e",
  },
  gruvbox: {
    primary: "#83a598",
    accent: "#8ec07c",
    error: "#fb4934",
    warning: "#fe8019",
    success: "#b8bb26",
    info: "#fabd2f",
    text: "#ebdbb2",
    textMuted: "#928374",
  },
  kanagawa: {
    primary: "#7E9CD8",
    accent: "#D27E99",
    error: "#E82424",
    warning: "#D7A657",
    success: "#98BB6C",
    info: "#76946A",
    text: "#DCD7BA",
    textMuted: "#727169",
  },
  "lucent-orng": {
    primary: "#EC5B2B",
    accent: "#FFF7F1",
    error: "#e06c75",
    warning: "#EC5B2B",
    success: "#6ba1e6",
    info: "#56b6c2",
    text: "#eeeeee",
    textMuted: "#808080",
  },
  material: {
    primary: "#82aaff",
    accent: "#89ddff",
    error: "#f07178",
    warning: "#ffcb6b",
    success: "#c3e88d",
    info: "#ffcb6b",
    text: "#eeffff",
    textMuted: "#546e7a",
  },
  matrix: {
    primary: "#2eff6a",
    accent: "#c770ff",
    error: "#ff4b4b",
    warning: "#e6ff57",
    success: "#62ff94",
    info: "#30b3ff",
    text: "#62ff94",
    textMuted: "#8ca391",
  },
  mercury: {
    primary: "#8da4f5",
    accent: "#8da4f5",
    error: "#fc92b4",
    warning: "#fc9b6f",
    success: "#77c599",
    info: "#77becf",
    text: "#dddde5",
    textMuted: "#9d9da8",
  },
  monokai: {
    primary: "#66d9ef",
    accent: "#a6e22e",
    error: "#f92672",
    warning: "#e6db74",
    success: "#a6e22e",
    info: "#fd971f",
    text: "#f8f8f2",
    textMuted: "#75715e",
  },
  nightowl: {
    primary: "#82AAFF",
    accent: "#c792ea",
    error: "#EF5350",
    warning: "#ecc48d",
    success: "#c5e478",
    info: "#82AAFF",
    text: "#d6deeb",
    textMuted: "#5f7e97",
  },
  nord: {
    primary: "#88C0D0",
    accent: "#8FBCBB",
    error: "#BF616A",
    warning: "#D08770",
    success: "#A3BE8C",
    info: "#88C0D0",
    text: "#ECEFF4",
    textMuted: "#8B95A7",
  },
  "one-dark": {
    primary: "#61afef",
    accent: "#56b6c2",
    error: "#e06c75",
    warning: "#e5c07b",
    success: "#98c379",
    info: "#d19a66",
    text: "#abb2bf",
    textMuted: "#5c6370",
  },
  opencode: {
    primary: "#fab283",
    accent: "#9d7cd8",
    error: "#e06c75",
    warning: "#f5a742",
    success: "#7fd88f",
    info: "#56b6c2",
    text: "#eeeeee",
    textMuted: "#808080",
  },
  orng: {
    primary: "#EC5B2B",
    accent: "#FFF7F1",
    error: "#e06c75",
    warning: "#EC5B2B",
    success: "#6ba1e6",
    info: "#56b6c2",
    text: "#eeeeee",
    textMuted: "#808080",
  },
  "osaka-jade": {
    primary: "#2DD5B7",
    accent: "#549e6a",
    error: "#FF5345",
    warning: "#E5C736",
    success: "#549e6a",
    info: "#2DD5B7",
    text: "#C1C497",
    textMuted: "#53685B",
  },
  palenight: {
    primary: "#82aaff",
    accent: "#89ddff",
    error: "#f07178",
    warning: "#ffcb6b",
    success: "#c3e88d",
    info: "#f78c6c",
    text: "#a6accd",
    textMuted: "#676e95",
  },
  rosepine: {
    primary: "#9ccfd8",
    accent: "#ebbcba",
    error: "#eb6f92",
    warning: "#f6c177",
    success: "#31748f",
    info: "#9ccfd8",
    text: "#e0def4",
    textMuted: "#6e6a86",
  },
  solarized: {
    primary: "#268bd2",
    accent: "#2aa198",
    error: "#dc322f",
    warning: "#b58900",
    success: "#859900",
    info: "#cb4b16",
    text: "#839496",
    textMuted: "#586e75",
  },
  synthwave84: {
    primary: "#36f9f6",
    accent: "#b084eb",
    error: "#fe4450",
    warning: "#fede5d",
    success: "#72f1b8",
    info: "#ff8b39",
    text: "#ffffff",
    textMuted: "#848bbd",
  },
  tokyonight: {
    primary: "#82aaff",
    accent: "#ff966c",
    error: "#ff757f",
    warning: "#ff966c",
    success: "#c3e88d",
    info: "#82aaff",
    text: "#c8d3f5",
    textMuted: "#828bb8",
  },
  vercel: {
    primary: "#0070F3",
    accent: "#8E4EC6",
    error: "#E5484D",
    warning: "#FFB224",
    success: "#46A758",
    info: "#52A8FF",
    text: "#EDEDED",
    textMuted: "#878787",
  },
  vesper: {
    primary: "#FFC799",
    accent: "#FFC799",
    error: "#FF8080",
    warning: "#FFC799",
    success: "#99FFE4",
    info: "#FFC799",
    text: "#FFF",
    textMuted: "#A0A0A0",
  },
  zenburn: {
    primary: "#8cd0d3",
    accent: "#93e0e3",
    error: "#cc9393",
    warning: "#f0dfaf",
    success: "#7f9f7f",
    info: "#dfaf8f",
    text: "#dcdccc",
    textMuted: "#9f9f9f",
  },
};

function readOpenCodeTheme(): string | null {
  const kvPath = join(
    process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    "opencode",
    "kv.json",
  );
  try {
    if (existsSync(kvPath)) {
      const kv = JSON.parse(readFileSync(kvPath, "utf-8"));
      if (typeof kv.theme === "string") return kv.theme;
    }
  } catch {
    // fall through
  }
  return null;
}

export function getTheme(): Theme {
  const name = process.env.PULSE_THEME || readOpenCodeTheme() || "opencode";
  return themes[name] || themes.opencode;
}
