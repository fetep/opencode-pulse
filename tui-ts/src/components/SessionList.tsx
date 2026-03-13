import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { type Session, querySessions, cleanupStaleSessions, dbExists, hasDbChanged, closeDb } from "../db.js";
import { attachToSession, isInsideTmux } from "../tmux.js";
import { getTheme, type Theme } from "../theme.js";

const POLL_INTERVAL_MS = 500;
const CLEANUP_INTERVAL_MS = 60_000;

const theme = getTheme();

const STATUS_ICONS: Record<string, string> = {
  permission_pending: "\u23F3",
  error: "\u2717",
  retry: "\u21BB",
  idle: "\u25CF",
  busy: "\u25E6",
};

function statusIcon(status: string): string {
  return STATUS_ICONS[status] || "?";
}

function statusColor(status: string): string {
  const colors: Record<string, string> = {
    permission_pending: theme.warning,
    error: theme.error,
    retry: theme.info,
    idle: theme.success,
    busy: theme.accent,
  };
  return colors[status] || theme.textMuted;
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
}

function SessionRow({ session, selected }: SessionRowProps) {
  const icon = statusIcon(session.status);
  const color = statusColor(session.status);
  const project = truncate(dirName(session.directory || ""), 20).padEnd(20);
  const title = session.title ? truncate(session.title, 30) : "";
  const todo = todoBar(session.todo_done, session.todo_total).padEnd(20);
  const time = relativeTime(session.updated_at).padEnd(10);
  const tmuxInfo = session.tmux_target ? `[${session.tmux_target}]` : "";

  return (
    <Box>
      <Text color={selected ? theme.text : undefined} bold={selected}>
        {selected ? "▸ " : "  "}
      </Text>
      <Text color={color}>{icon} </Text>
      <Text color={theme.text} bold>
        {project}
      </Text>
      <Text color={theme.textMuted}> </Text>
      <Text color={theme.warning}>
        {todo}
      </Text>
      <Text color={theme.textMuted}> </Text>
      <Text color={theme.info}>
        {time}
      </Text>
      {title ? (
        <>
          <Text color={theme.textMuted}> </Text>
          <Text color={theme.text}>
            {title}
          </Text>
        </>
      ) : null}
      {tmuxInfo ? (
        <>
          <Text color={theme.textMuted}> </Text>
          <Text color={theme.textMuted} dimColor>{tmuxInfo}</Text>
        </>
      ) : null}
      {session.status === "error" && session.error_message ? (
        <>
          <Text color={theme.textMuted}> </Text>
          <Text color={theme.error}>{truncate(session.error_message, 30)}</Text>
        </>
      ) : null}
      {session.status === "retry" && session.retry_message ? (
        <>
          <Text color={theme.textMuted}> </Text>
          <Text color={theme.info}>{truncate(session.retry_message, 30)}</Text>
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

  const refresh = useCallback((force = false) => {
    setHasDb(dbExists());
    if (force || hasDbChanged()) {
      setSessions(querySessions());
    }
  }, []);

  useEffect(() => {
    refresh(true);
    const timer = setInterval(() => refresh(), POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      closeDb();
    };
  }, [refresh]);

  useEffect(() => {
    cleanupStaleSessions();
    const timer = setInterval(cleanupStaleSessions, CLEANUP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

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

  });

  const inTmux = isInsideTmux();

  if (!hasDb) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.primary} bold>pulse</Text>
        <Text color={theme.textMuted}>
          Waiting for database at {process.env.PULSE_DB_PATH || "~/.local/share/opencode-pulse/status.db"}…
        </Text>
        <Text color={theme.textMuted} dimColor>
          Install the pulse plugin in your OpenCode config to get started.
        </Text>
      </Box>
    );
  }

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.primary} bold>pulse</Text>
        <Text color={theme.textMuted}>No active sessions. Polling…</Text>
        <Box marginTop={1}>
          <Text color={theme.textMuted} dimColor>q: quit</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>pulse</Text>
        <Text color={theme.textMuted}>
          {" "}&mdash; {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </Text>
        {!inTmux ? <Text color={theme.error}> (not in tmux)</Text> : null}
      </Box>

      <Box flexDirection="column">
        {sessions.map((session, idx) => (
          <SessionRow
            key={session.session_id}
            session={session}
            selected={idx === selectedIdx}
          />
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.textMuted} dimColor>
          j/k: navigate  enter: attach  q: quit
        </Text>
      </Box>
    </Box>
  );
}
