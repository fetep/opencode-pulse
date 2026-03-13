#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import {
  SessionList,
  DEFAULT_COLUMNS,
  ALL_COLUMNS,
  COLUMN_META,
  type ColumnId,
} from "./components/SessionList.js";
import { execAttach } from "./tmux.js";

function parseArgs(): { columns: ColumnId[]; help: boolean } {
  const args = process.argv.slice(2);
  let columns: ColumnId[] | null = null;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--columns" || arg === "-c") {
      const val = args[++i];
      if (val) {
        const parsed = val
          .split(",")
          .filter((c): c is ColumnId => ALL_COLUMNS.includes(c as ColumnId));
        if (parsed.length > 0) columns = parsed;
      }
    } else if (arg.startsWith("--columns=")) {
      const val = arg.slice("--columns=".length);
      const parsed = val
        .split(",")
        .filter((c): c is ColumnId => ALL_COLUMNS.includes(c as ColumnId));
      if (parsed.length > 0) columns = parsed;
    }
  }

  return { columns: columns ?? DEFAULT_COLUMNS, help };
}

const { columns, help } = parseArgs();

if (help) {
  const colList = ALL_COLUMNS.map(
    (c) => `  ${c.padEnd(10)} ${COLUMN_META[c].description}`,
  ).join("\n");

  console.log(`Usage: pulse [options]

Options:
  -c, --columns <cols>  Comma-separated columns (default: ${DEFAULT_COLUMNS.join(",")})
  -h, --help            Show this help

Available columns:
${colList}

Examples:
  pulse
  pulse --columns status,project,title,updated
  pulse -c status,project,todo,message`);

  process.exit(0);
}

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
    columns={columns}
    onSelect={(session: SessionTarget) => {
      selectedSession = session;
    }}
  />,
);

await waitForExit;

if (selectedSession) {
  execAttach(selectedSession);
}
