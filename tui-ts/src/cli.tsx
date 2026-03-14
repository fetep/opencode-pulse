#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { type ArgsDef, type CommandDef, defineCommand, renderUsage, runMain } from "citty";
import {
  ALL_COLUMNS,
  COLUMN_META,
  DEFAULT_COLUMNS,
  SessionList,
} from "./components/SessionList.js";
import { resolveConfig } from "./config.js";
import { setDbPath, warmDb } from "./db.js";
import { setThemeName } from "./theme.js";
import { execAttach } from "./tmux.js";

const main = defineCommand({
  meta: {
    name: "pulse",
    description: "Monitor your OpenCode sessions",
  },
  args: {
    columns: {
      type: "string",
      alias: "c",
      description: `Comma-separated columns (default: ${DEFAULT_COLUMNS.join(",")})`,
    },
    theme: {
      type: "string",
      alias: "t",
      description: "Theme name (same themes as OpenCode, auto-detected by default)",
    },
    "db-path": {
      type: "string",
      description: "Path to SQLite database (default: ~/.local/share/opencode-pulse/status.db)",
    },
    debug: {
      type: "boolean",
      description: "Enable debug logging (plugin writes to ~/.local/share/opencode-pulse/debug.log)",
    },
  },
  async run({ args }) {
    const config = resolveConfig(args);
    setDbPath(config.dbPath);
    setThemeName(config.theme);
    warmDb();

    type SessionTarget = { tmux_target: string; tmux_pane: string };
    let selectedSession: SessionTarget | null = null;

    const { promise: waitForExit, resolve: signalExit } =
      Promise.withResolvers<void>();

    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      onDestroy: () => signalExit(),
    });

    createRoot(renderer).render(
      <SessionList
        columns={config.columns}
        onSelect={(session: SessionTarget) => {
          selectedSession = session;
        }}
      />,
    );

    await waitForExit;

    if (selectedSession) {
      execAttach(selectedSession);
    }
  },
});

async function showUsageWithColumns<T extends ArgsDef>(cmd: CommandDef<T>) {
  const usage = await renderUsage(cmd);
  const colList = ALL_COLUMNS.map(
    (c) => `  ${c.padEnd(10)} ${COLUMN_META[c].description}`,
  ).join("\n");

  console.log(`${usage}
Available columns:
${colList}

Config file:
  ~/.config/opencode/pulse.jsonc  (or pulse.json)

  All CLI options can also be set in the config file:
  {"columns": "status,project,title", "theme": "catppuccin", "debug": true}

  Override order: CLI flag > env var > config file > default

Examples:
  pulse
  pulse --columns status,project,title,updated
  pulse -c status,project,todo,message`);
}

runMain(main, { showUsage: showUsageWithColumns });
