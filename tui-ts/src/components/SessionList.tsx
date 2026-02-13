import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { type Session, querySessions, isStale, dbExists } from "../db.js";
import { attachToSession, isInsideTmux } from "../tmux.js";

const POLL_INTERVAL_MS = 2000;

const STATUS_ICONS: Record<string, string> = {
  permission_pending: "\u23F3",
  error: "\u2717",
  retry: "\u21BB",
  idle: "\u25CF",
  busy: "\u25E6",
};

const STATUS_COLORS: Record<string, string> = {
  permission_pending: "yellow",
  error: "red",
  retry: "cyan",
  idle: "green",
  busy: "blue",
};

function statusIcon(status: string, stale: boolean): string {
  if (stale) return "?";
  return STATUS_ICONS[status] || "?";
}

function statusColor(status: string): string {
  return STATUS_COLORS[status] || "gray";
}

function relativeTime(timestampMs: number): string {
  const nowMs = Date.now();
  const diffS = Math.floor((nowMs - timestampMs) / 1000);

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
  const width = 8;
  let filled = Math.round((done / total) * width);
  if (filled > width) filled = width;
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${done}/${total}`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  if (maxLen <= 1) return str.slice(0, maxLen);
  return str.slice(0, maxLen - 1) + "…";
}

function dirName(dir: string): string {
  if (!dir) return "unknown";
  const parts = dir.split("/");
  return parts[parts.length - 1] || dir;
}

interface SessionRowProps {
  session: Session;
  selected: boolean;
  stale: boolean;
}

function SessionRow({ session, selected, stale }: SessionRowProps) {
  const icon = statusIcon(session.status, stale);
  const color = stale ? "gray" : statusColor(session.status);
  const project = truncate(dirName(session.directory || ""), 20).padEnd(20);
  const title = session.title ? truncate(session.title, 30) : "";
  const todo = todoBar(session.todo_done, session.todo_total).padEnd(20);
  const time = relativeTime(session.updated_at).padEnd(10);
  const tmuxInfo = session.tmux_target ? `[${session.tmux_target}]` : "";

  return (
    <Box>
      <Text color={selected ? "white" : undefined} bold={selected}>
        {selected ? "▸ " : "  "}
      </Text>
      <Text color={color}>{icon} </Text>
      <Text color={stale ? "gray" : "white"} bold={!stale}>
        {project}
      </Text>
      <Text color="gray"> </Text>
      <Text color={stale ? "gray" : "yellowBright"}>
        {todo}
      </Text>
      <Text color="gray"> </Text>
      <Text color={stale ? "gray" : "cyan"}>
        {time}
      </Text>
      {title ? (
        <>
          <Text color="gray"> </Text>
          <Text color={stale ? "gray" : undefined} dimColor={stale}>
            {title}
          </Text>
        </>
      ) : null}
      {tmuxInfo ? (
        <>
          <Text color="gray"> </Text>
          <Text color="gray" dimColor>{tmuxInfo}</Text>
        </>
      ) : null}
      {stale ? <Text color="gray"> (stale)</Text> : null}
      {!stale && session.status === "error" && session.error_message ? (
        <>
          <Text color="gray"> </Text>
          <Text color="red">{truncate(session.error_message, 30)}</Text>
        </>
      ) : null}
      {!stale && session.status === "retry" && session.retry_message ? (
        <>
          <Text color="gray"> </Text>
          <Text color="cyan">{truncate(session.retry_message, 30)}</Text>
        </>
      ) : null}
    </Box>
  );
}

export function SessionList() {
  const { exit } = useApp();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hasDb, setHasDb] = useState(false);

  const refresh = useCallback(() => {
    setHasDb(dbExists());
    setSessions(querySessions());
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (selectedIdx >= sessions.length && sessions.length > 0) {
      setSelectedIdx(sessions.length - 1);
    }
    if (sessions.length === 0) {
      setSelectedIdx(0);
    }
  }, [sessions.length, selectedIdx]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }

    if (sessions.length === 0) return;

    if (key.downArrow || input === "j") {
      setSelectedIdx((i) => (i + 1) % sessions.length);
    }
    if (key.upArrow || input === "k") {
      setSelectedIdx((i) => (i - 1 + sessions.length) % sessions.length);
    }

    if (key.return) {
      const session = sessions[selectedIdx];
      if (session) {
        attachToSession(session);
      }
    }

    if (input === "r") {
      refresh();
    }
  });

  const inTmux = isInsideTmux();

  if (!hasDb) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="yellow" bold>pulse</Text>
        <Text color="gray">
          Waiting for database at {process.env.PULSE_DB_PATH || "~/.local/share/opencode-pulse/status.db"}…
        </Text>
        <Text color="gray" dimColor>
          Install the pulse plugin in your OpenCode config to get started.
        </Text>
      </Box>
    );
  }

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="yellow" bold>pulse</Text>
        <Text color="gray">No active sessions. Polling…</Text>
        <Box marginTop={1}>
          <Text color="gray" dimColor>q: quit</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>pulse</Text>
        <Text color="gray">
          {" "}&mdash; {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </Text>
        {!inTmux ? <Text color="red"> (not in tmux)</Text> : null}
      </Box>

      <Box flexDirection="column">
        {sessions.map((session, idx) => (
          <SessionRow
            key={session.session_id}
            session={session}
            selected={idx === selectedIdx}
            stale={isStale(session)}
          />
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          j/k: navigate  enter: attach  r: refresh  q: quit
        </Text>
      </Box>
    </Box>
  );
}
