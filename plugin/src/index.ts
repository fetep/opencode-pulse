import { Database } from "bun:sqlite";
import { readFileSync, appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";

const DB_PATH = process.env.PULSE_DB_PATH || join(homedir(), ".local/share/opencode-pulse/status.db");
const SCHEMA_PATH = join(import.meta.dir, "../../schema.sql");
const HEARTBEAT_INTERVAL = 10000;
const DEBUG_LOG = join(homedir(), ".local/share/opencode-pulse/debug.log");

function debugLog(msg: string) {
  try {
    appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] [pid=${process.pid}] ${msg}\n`);
  } catch {}
}

function getSessionFromCmdline(): string | null {
  try {
    const args = readFileSync("/proc/self/cmdline", "utf-8").split("\0");
    const idx = args.indexOf("-s");
    if (idx !== -1 && idx + 1 < args.length && args[idx + 1]) {
      return args[idx + 1];
    }
    return null;
  } catch {
    return null;
  }
}

function summarizeEvent(event: { type: string; properties: Record<string, unknown> }): string {
  const p = event.properties;
  switch (event.type) {
    case "session.diff": {
      const diff = p.diff as Array<{ file: string; additions: number; deletions: number }> | undefined;
      if (diff) {
        const files = diff.map(d => `${d.file}(+${d.additions}/-${d.deletions})`).join(", ");
        return `session.diff sid=${p.sessionID} [${files}]`;
      }
      return `session.diff sid=${p.sessionID}`;
    }
    case "message.updated": {
      const info = p.info as Record<string, unknown> | undefined;
      if (info) {
        return `message.updated sid=${info.sessionID} msg=${info.id} role=${info.role}`;
      }
      return `message.updated ${JSON.stringify(p)}`;
    }
    case "message.part.updated": {
      const part = p.part as Record<string, unknown> | undefined;
      if (part) {
        const state = part.state as Record<string, unknown> | undefined;
        const status = state?.status || "";
        const tool = part.tool || "";
        return `message.part.updated sid=${part.sessionID} type=${part.type}${tool ? ` tool=${tool}` : ""} status=${status}`;
      }
      return `message.part.updated ${JSON.stringify(p)}`;
    }
    default:
      return `${event.type} ${JSON.stringify(p)}`;
  }
}

interface SessionRow {
  pid: number;
  session_id: string | null;
  project_id: string | null;
  directory: string | null;
  title: string | null;
  status: string;
  retry_message: string | null;
  retry_next: number | null;
  error_message: string | null;
  tmux_pane: string | null;
  tmux_target: string | null;
  opencode_version: string | null;
  todo_total: number;
  todo_done: number;
  heartbeat_at: number;
  created_at: number;
  updated_at: number;
}

const plugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const { project } = input;
  const pid = process.pid;

  const tmuxPane = process.env.TMUX_PANE || null;
  let tmuxTarget: string | null = null;
  if (tmuxPane) {
    try {
      const result = await input.$`tmux display-message -p -t ${tmuxPane} '#{session_name}:#{window_index}'`.text();
      tmuxTarget = result.trim();
    } catch {
      tmuxTarget = null;
    }
  }

  const dbDir = join(homedir(), ".local/share/opencode-pulse");
  await input.$`mkdir -p ${dbDir}`.quiet();

  const db = new Database(DB_PATH);

  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);

  db.exec("PRAGMA journal_mode = WAL");

  const versionRow = db.query("SELECT version FROM schema_version").get() as { version: number } | null;
  if (!versionRow || versionRow.version !== 3) {
    throw new Error(`Schema version mismatch: expected 3, got ${versionRow?.version}`);
  }

  const pendingPermissions = new Set<string>();
  let sessionFromEvent = false;
  const cmdlineSessionId = getSessionFromCmdline();
  debugLog(`startup: tmuxPane=${tmuxPane} dir=${project.worktree} cmdlineSession=${cmdlineSessionId}`);

  const upsertProcess = (updates: Partial<Omit<SessionRow, "pid">>) => {
    const now = Date.now();
    const existing = db
      .query("SELECT * FROM sessions WHERE pid = ?")
      .get(pid) as SessionRow | null;

    if (existing) {
      const fields = Object.keys(updates)
        .map((k) => `${k} = ?`)
        .join(", ");
      db.query(`UPDATE sessions SET ${fields}, updated_at = ?, heartbeat_at = ? WHERE pid = ?`).run(
        ...Object.values(updates),
        now,
        now,
        pid,
      );
    } else {
      const defaults: SessionRow = {
        pid,
        session_id: null,
        project_id: project.id,
        directory: project.worktree,
        title: null,
        status: "idle",
        retry_message: null,
        retry_next: null,
        error_message: null,
        tmux_pane: tmuxPane,
        tmux_target: tmuxTarget,
        opencode_version: null,
        todo_total: 0,
        todo_done: 0,
        heartbeat_at: now,
        created_at: now,
        updated_at: now,
        ...updates,
      };
      db.query(
        `INSERT INTO sessions (
          pid, session_id, project_id, directory, title, status,
          retry_message, retry_next, error_message, tmux_pane, tmux_target,
          opencode_version, todo_total, todo_done, heartbeat_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        defaults.pid,
        defaults.session_id,
        defaults.project_id,
        defaults.directory,
        defaults.title,
        defaults.status,
        defaults.retry_message,
        defaults.retry_next,
        defaults.error_message,
        defaults.tmux_pane,
        defaults.tmux_target,
        defaults.opencode_version,
        defaults.todo_total,
        defaults.todo_done,
        defaults.heartbeat_at,
        defaults.created_at,
        defaults.updated_at,
      );
    }
  };

  const cleanup = () => {
    clearInterval(heartbeatTimer);
    try {
      db.query("DELETE FROM sessions WHERE pid = ?").run(pid);
    } catch {}
    try {
      db.close();
    } catch {}
  };

  const heartbeat = async () => {
    const now = Date.now();
    if (tmuxPane) {
      try {
        const result = await input.$`tmux display-message -p -t ${tmuxPane} '#{session_name}:#{window_index}'`.text();
        const newTarget = result.trim();
        if (newTarget && newTarget !== tmuxTarget) {
          tmuxTarget = newTarget;
          db.query("UPDATE sessions SET tmux_target = ? WHERE pid = ?").run(tmuxTarget, pid);
        }
      } catch {}
    }
    db.query("UPDATE sessions SET heartbeat_at = ? WHERE pid = ?").run(now, pid);
  };

  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL);

  upsertProcess({});

  // Populate session metadata on startup.
  // If launched with `-s <id>`, fetch that session directly.
  // Otherwise fall back to status-based discovery for the current directory.
  // Deferred: server isn't ready during plugin init, so we can't await here.
  setTimeout(async () => {
    try {
      if (sessionFromEvent) {
        debugLog("adopt: skipped, session already known from event");
        return;
      }

      // Direct path: cmdline told us exactly which session
      if (cmdlineSessionId) {
        const { data: session } = await input.client.session.get({
          path: { id: cmdlineSessionId },
        });
        if (session) {
          upsertProcess({
            session_id: session.id,
            project_id: session.projectID,
            directory: session.directory,
            title: session.title,
            opencode_version: session.version,
          });
          debugLog(`adopt: cmdline session id=${session.id} title="${session.title}"`);
          return;
        }
        debugLog(`adopt: cmdline session ${cmdlineSessionId} not found, falling back`);
      }

      // Fallback: discover active session by directory
      const { data: statuses } = await input.client.session.status({
        query: { directory: project.worktree },
      });
      const ids = statuses ? Object.keys(statuses) : [];
      debugLog(`adopt: status keys=[${ids.join(",")}]`);
      if (ids.length === 0) return;
      const activeId = ids.find((id) => statuses![id].type === "busy" || statuses![id].type === "idle");
      if (!activeId) return;
      const { data: sessions } = await input.client.session.list({
        query: { directory: project.worktree },
      });
      const session = sessions?.find((s) => s.id === activeId);
      if (session) {
        upsertProcess({
          session_id: session.id,
          project_id: session.projectID,
          directory: session.directory,
          title: session.title,
          opencode_version: session.version,
        });
        debugLog(`adopt: success id=${session.id} title="${session.title}"`);
      }
    } catch (e) {
      debugLog(`adopt: failed ${e}`);
    }
  }, 2000);

  process.on("exit", cleanup);

  return {
    event: async ({ event }: { event: Event }) => {
      debugLog(summarizeEvent(event as unknown as { type: string; properties: Record<string, unknown> }));
      if ("sessionID" in event.properties || (event.type === "session.created" || event.type === "session.updated")) {
        sessionFromEvent = true;
      }
      switch (event.type) {
        case "session.status": {
          const { sessionID, status } = event.properties;
          if (status.type === "idle") {
            upsertProcess({ session_id: sessionID, status: "idle", retry_message: null, retry_next: null });
          } else if (status.type === "busy") {
            upsertProcess({ session_id: sessionID, status: "busy" });
          } else if (status.type === "retry") {
            upsertProcess({
              session_id: sessionID,
              status: "retry",
              retry_message: status.message,
              retry_next: status.next,
            });
          }
          break;
        }

        case "session.idle": {
          const { sessionID } = event.properties;
          upsertProcess({ session_id: sessionID, status: "idle" });
          break;
        }

        case "session.created": {
          const { info } = event.properties;
          upsertProcess({
            session_id: info.id,
            project_id: info.projectID,
            directory: info.directory,
            title: info.title,
            opencode_version: info.version,
            status: "idle",
          });
          break;
        }

        case "session.updated": {
          const { info } = event.properties;
          upsertProcess({
            session_id: info.id,
            project_id: info.projectID,
            directory: info.directory,
            title: info.title,
            opencode_version: info.version,
          });
          break;
        }

        case "session.deleted": {
          upsertProcess({
            session_id: null,
            title: null,
            status: "idle",
            todo_total: 0,
            todo_done: 0,
          });
          break;
        }

        case "session.error": {
          const { sessionID, error } = event.properties;
          const errorMsg = error ? JSON.stringify(error) : null;
          upsertProcess({ session_id: sessionID, status: "error", error_message: errorMsg });
          break;
        }

        case "permission.updated": {
          const { id } = event.properties;
          pendingPermissions.add(id);
          upsertProcess({ status: "permission_pending" });
          break;
        }

        case "permission.replied": {
          const { permissionID } = event.properties;
          pendingPermissions.delete(permissionID);
          if (pendingPermissions.size === 0) {
            upsertProcess({ status: "idle" });
          }
          break;
        }

        case "todo.updated": {
          const { todos } = event.properties;
          const total = todos.length;
          const done = todos.filter((t) => t.status === "completed").length;
          upsertProcess({ todo_total: total, todo_done: done });
          break;
        }

        case "server.instance.disposed": {
          cleanup();
          break;
        }

        default:
          break;
      }
    },
  };
};

export default plugin;
