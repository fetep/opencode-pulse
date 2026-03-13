import { Fragment, useState, useEffect, useCallback } from "react";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import {
  type Session,
  querySessions,
  cleanupStaleSessions,
  dbExists,
  hasDbChanged,
  closeDb,
} from "../db.js";
import { isInsideTmux } from "../tmux.js";
import { getTheme } from "../theme.js";

const POLL_INTERVAL_MS = 500;
const CLEANUP_INTERVAL_MS = 60_000;

const theme = getTheme();

export type ColumnId =
  | "status"
  | "project"
  | "title"
  | "todo"
  | "updated"
  | "age"
  | "pid"
  | "session"
  | "version"
  | "tmux"
  | "message";

interface ColumnMeta {
  header: string;
  minWidth: number;
  flex: boolean;
  fitContent?: boolean;
  description: string;
}

export const ALL_COLUMNS: ColumnId[] = [
  "status",
  "project",
  "title",
  "todo",
  "updated",
  "age",
  "pid",
  "session",
  "version",
  "tmux",
  "message",
];

export const DEFAULT_COLUMNS: ColumnId[] = [
  "status",
  "project",
  "todo",
  "updated",
  "title",
];

export const COLUMN_META: Record<ColumnId, ColumnMeta> = {
  status: {
    header: "STATUS",
    minWidth: 12,
    flex: false,
    description:
      "Session status with icon (\u25B2 Pending, \u2717 Error, \u21BB Retry, \u25CF Idle, \u25E6 Busy)",
  },
  project: {
    header: "PROJECT",
    minWidth: 12,
    flex: true,
    description: "Project directory name",
  },
  title: {
    header: "TITLE",
    minWidth: 10,
    flex: true,
    description: "Session title or task description",
  },
  todo: {
    header: "PROGRESS",
    minWidth: 16,
    flex: false,
    description: "Todo progress bar with done/total count",
  },
  updated: {
    header: "UPDATED",
    minWidth: 8,
    flex: false,
    description: "Time since last update",
  },
  age: {
    header: "AGE",
    minWidth: 8,
    flex: false,
    description: "Time since session was created",
  },
  pid: {
    header: "PID",
    minWidth: 7,
    flex: false,
    description: "OpenCode process ID",
  },
  session: {
    header: "SESSION",
    minWidth: 10,
    flex: false,
    description: "Session ID",
  },
  version: {
    header: "VERSION",
    minWidth: 8,
    flex: false,
    description: "OpenCode version",
  },
  tmux: {
    header: "TMUX",
    minWidth: 8,
    flex: false,
    fitContent: true,
    description: "Tmux session name",
  },
  message: {
    header: "MESSAGE",
    minWidth: 10,
    flex: true,
    description: "Error or retry message (contextual)",
  },
};

const STATUS_ICONS: Record<string, string> = {
  permission_pending: "\u25B2",
  question_pending: "?",
  error: "\u2717",
  retry: "\u21BB",
  idle: "\u25CF",
  busy: "\u25E6",
};

const STATUS_LABELS: Record<string, string> = {
  permission_pending: "Permission",
  question_pending: "Question",
  error: "Error",
  retry: "Retry",
  idle: "Idle",
  busy: "Busy",
};

function statusColor(status: string): string {
  const colors: Record<string, string> = {
    permission_pending: theme.warning,
    question_pending: theme.warning,
    error: theme.error,
    retry: theme.info,
    idle: theme.success,
    busy: theme.accent,
  };
  return colors[status] || theme.textMuted;
}

function relativeTime(timestampMs: number): string {
  const diffS = Math.floor((Date.now() - timestampMs) / 1000);
  if (diffS < 60) return `${diffS}s ago`;
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

function todoBar(done: number, total: number): string {
  if (total === 0) return "\u2014";
  const barWidth = 8;
  const filled = Math.min(Math.round((done / total) * barWidth), barWidth);
  const empty = barWidth - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${done}/${total}`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  if (maxLen <= 1) return str.slice(0, maxLen);
  return str.slice(0, maxLen - 1) + "\u2026";
}

function dirName(dir: string): string {
  if (!dir) return "unknown";
  const parts = dir.split("/");
  return parts[parts.length - 1] || dir;
}

const SELECTOR_WIDTH = 2;
const COL_GAP = 2;

function fitContentWidth(col: ColumnId, sessions: Session[]): number {
  const meta = COLUMN_META[col];
  let maxLen = meta.minWidth;
  for (const session of sessions) {
    let text = "";
    switch (col) {
      case "tmux":
        text = session.tmux_target || session.tmux_pane || "\u2014";
        break;
    }
    if (text.length > maxLen) maxLen = text.length;
  }
  return maxLen;
}

function allocateWidths(
  columns: ColumnId[],
  totalWidth: number,
  sessions: Session[],
): number[] {
  const available =
    totalWidth - SELECTOR_WIDTH - (columns.length - 1) * COL_GAP;
  const widths = columns.map((c) => {
    const meta = COLUMN_META[c];
    if (meta.fitContent) return fitContentWidth(c, sessions);
    return meta.minWidth;
  });
  const used = widths.reduce((a, b) => a + b, 0);
  let remaining = available - used;

  if (remaining > 0) {
    const flexIndices = columns
      .map((c, i) => (COLUMN_META[c].flex ? i : -1))
      .filter((i) => i >= 0);
    if (flexIndices.length > 0) {
      const perFlex = Math.floor(remaining / flexIndices.length);
      const extra = remaining % flexIndices.length;
      flexIndices.forEach((idx, i) => {
        widths[idx] += perFlex + (i < extra ? 1 : 0);
      });
    }
  }

  return widths.map((w) => Math.max(w, 1));
}

function renderCell(
  col: ColumnId,
  session: Session,
  width: number,
): { text: string; color: string } {
  switch (col) {
    case "status": {
      const icon = STATUS_ICONS[session.status] || "?";
      const label = STATUS_LABELS[session.status] || session.status;
      return {
        text: truncate(`${icon} ${label}`, width).padEnd(width),
        color: statusColor(session.status),
      };
    }
    case "project":
      return {
        text: truncate(dirName(session.directory), width).padEnd(width),
        color: theme.text,
      };
    case "title":
      return {
        text: truncate(session.title || "\u2014", width).padEnd(width),
        color: theme.text,
      };
    case "todo":
      return {
        text: truncate(
          todoBar(session.todo_done, session.todo_total),
          width,
        ).padEnd(width),
        color: session.todo_total > 0 ? theme.warning : theme.textMuted,
      };
    case "updated":
      return {
        text: truncate(relativeTime(session.updated_at), width).padEnd(width),
        color: theme.textMuted,
      };
    case "age":
      return {
        text: truncate(relativeTime(session.created_at), width).padEnd(width),
        color: theme.textMuted,
      };
    case "pid":
      return {
        text: String(session.pid).padEnd(width),
        color: theme.textMuted,
      };
    case "session":
      return {
        text: truncate(session.session_id || "\u2014", width).padEnd(width),
        color: theme.textMuted,
      };
    case "version":
      return {
        text: truncate(
          session.opencode_version ? `v${session.opencode_version}` : "\u2014",
          width,
        ).padEnd(width),
        color: theme.textMuted,
      };
    case "tmux":
      return {
        text: truncate(
          session.tmux_target || session.tmux_pane || "\u2014",
          width,
        ).padEnd(width),
        color: theme.textMuted,
      };
    case "message": {
      const msg =
        session.status === "error"
          ? session.error_message
          : session.status === "retry"
            ? session.retry_message
            : "";
      return {
        text: truncate(msg || "\u2014", width).padEnd(width),
        color: session.status === "error" ? theme.error : theme.info,
      };
    }
  }
}

function buildRowText(
  columns: ColumnId[],
  session: Session,
  colWidths: number[],
): { text: string; colors: { start: number; end: number; color: string }[] } {
  const selector = "\u25B8 ";
  const parts: string[] = [];
  const colors: { start: number; end: number; color: string }[] = [];

  let offset = SELECTOR_WIDTH;
  for (let i = 0; i < columns.length; i++) {
    const cell = renderCell(columns[i], session, colWidths[i]);
    colors.push({ start: offset, end: offset + cell.text.length, color: cell.color });
    parts.push(cell.text);
    offset += cell.text.length;
    if (i < columns.length - 1) {
      parts.push("  ");
      offset += COL_GAP;
    }
  }

  return { text: selector + parts.join(""), colors };
}

interface SessionRowProps {
  session: Session;
  selected: boolean;
  columns: ColumnId[];
  colWidths: number[];
}

function SessionRow({
  session,
  selected,
  columns,
  colWidths,
}: SessionRowProps) {
  const selector = selected ? "\u25B8 " : "  ";

  return (
    <text>
      <span fg={selected ? theme.primary : undefined}>
        {selected ? <strong>{selector}</strong> : selector}
      </span>
      {columns.map((col, i) => {
        const cell = renderCell(col, session, colWidths[i]);
        const gap = i < columns.length - 1 ? "  " : "";
        return (
          <Fragment key={col}>
            <span fg={cell.color}>
              {selected ? <strong>{cell.text}</strong> : cell.text}
            </span>
            {gap}
          </Fragment>
        );
      })}
    </text>
  );
}

interface SessionListProps {
  columns: ColumnId[];
  onSelect: (session: { tmux_target: string; tmux_pane: string }) => void;
}

export function SessionList({ columns, onSelect }: SessionListProps) {
  const renderer = useRenderer();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hasDb, setHasDb] = useState(false);
  const { width } = useTerminalDimensions();

  const refresh = useCallback((force = false) => {
    setHasDb(dbExists());
    if (force || hasDbChanged()) {
      setSessions(querySessions());
    }
  }, []);

  useEffect(() => {
    cleanupStaleSessions();
    refresh(true);
    const pollTimer = setInterval(() => refresh(), POLL_INTERVAL_MS);
    const cleanupTimer = setInterval(
      cleanupStaleSessions,
      CLEANUP_INTERVAL_MS,
    );
    return () => {
      clearInterval(pollTimer);
      clearInterval(cleanupTimer);
      closeDb();
    };
  }, [refresh]);

  useEffect(() => {
    if (selectedIdx >= sessions.length && sessions.length > 0) {
      setSelectedIdx(sessions.length - 1);
    }
    if (sessions.length === 0) {
      setSelectedIdx(0);
    }
  }, [sessions.length, selectedIdx]);

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy();
      return;
    }
    if (sessions.length === 0) return;
    if (key.name === "down" || key.name === "j") {
      setSelectedIdx((i) => (i + 1) % sessions.length);
    }
    if (key.name === "up" || key.name === "k") {
      setSelectedIdx((i) => (i - 1 + sessions.length) % sessions.length);
    }
    if (key.name === "return") {
      const session = sessions[selectedIdx];
      if (session?.tmux_target || session?.tmux_pane) {
        onSelect(session);
        renderer.destroy();
      }
    }
  });

  const inTmux = isInsideTmux();
  const colWidths = allocateWidths(columns, width, sessions);

  const header = (
    <text>
      <span fg={theme.primary}>
        <strong>pulse</strong>
      </span>
      <span fg={theme.textMuted}>
        {" \u2014 "}
        {sessions.length} process
        {sessions.length !== 1 ? "es" : ""}
      </span>
      {!inTmux ? <span fg={theme.error}> (not in tmux)</span> : null}
    </text>
  );

  const footer = (
    <text fg={theme.textMuted}>
      j/k: navigate  enter: attach  q: quit
    </text>
  );

  if (!hasDb) {
    return (
      <box flexDirection="column" width="100%" height="100%">
        {header}
        <box marginTop={1}>
          <text fg={theme.textMuted}>
            Waiting for database at{" "}
            {process.env.PULSE_DB_PATH ||
              "~/.local/share/opencode-pulse/status.db"}
            {"\u2026"}
          </text>
        </box>
        <box flexGrow={1} />
        {footer}
      </box>
    );
  }

  if (sessions.length === 0) {
    return (
      <box flexDirection="column" width="100%" height="100%">
        {header}
        <box marginTop={1}>
          <text fg={theme.textMuted}>
            No active sessions. Polling{"\u2026"}
          </text>
        </box>
        <box flexGrow={1} />
        {footer}
      </box>
    );
  }

  const columnHeaders = (
    <text>
      {"  "}
      {columns.map((col, i) => {
        const gap = i < columns.length - 1 ? "  " : "";
        return (
          <Fragment key={col}>
            <span fg={theme.textMuted}>
              <strong>{COLUMN_META[col].header.padEnd(colWidths[i])}</strong>
            </span>
            {gap}
          </Fragment>
        );
      })}
    </text>
  );

  return (
    <box flexDirection="column" width="100%" height="100%">
      {header}
      <text>{" "}</text>
      {columnHeaders}
      <text fg={theme.textMuted}>{"\u2500".repeat(width)}</text>

      {sessions.map((session, idx) => (
        <SessionRow
          key={session.pid}
          session={session}
          selected={idx === selectedIdx}
          columns={columns}
          colWidths={colWidths}
        />
      ))}

      <box flexGrow={1} />
      {footer}
    </box>
  );
}
