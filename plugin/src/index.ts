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
    appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
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
  session_id: string;
  project_id: string | null;
  directory: string | null;
  title: string | null;
  status: string;
  retry_message: string | null;
  retry_next: number | null;
  error_message: string | null;
  tmux_pane: string | null;
  tmux_target: string | null;
  todo_total: number;
  todo_done: number;
  heartbeat_at: number;
  created_at: number;
  updated_at: number;
}

const plugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const { project } = input;

  // Capture tmux info on startup
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

  // Initialize database
  const dbDir = join(homedir(), ".local/share/opencode-pulse");
  await input.$`mkdir -p ${dbDir}`.quiet();

  const db = new Database(DB_PATH);

  // Run schema first
  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);

  // Set WAL mode after schema (must be after table creation)
  db.exec("PRAGMA journal_mode = WAL");

  const versionRow = db.query("SELECT version FROM schema_version").get() as { version: number } | null;
  if (!versionRow || versionRow.version !== 1) {
    throw new Error(`Schema version mismatch: expected 1, got ${versionRow?.version}`);
  }

  // Track pending permissions per session
  const pendingPermissions = new Map<string, Set<string>>();
  // Track session IDs managed by this plugin instance
  const managedSessions = new Set<string>();
  debugLog(`startup: tmuxPane=${tmuxPane} dir=${project.worktree} managed=[${[...managedSessions].join(',')}]`);

  const upsertSession = (
    sessionID: string,
    updates: Partial<Omit<SessionRow, "session_id">>
  ) => {
    managedSessions.add(sessionID);
    const now = Date.now();
    const existing = db
      .query("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionID) as SessionRow | null;

    if (existing) {
      const fields = Object.keys(updates)
        .map((k) => `${k} = ?`)
        .join(", ");
      db.query(`UPDATE sessions SET ${fields}, updated_at = ?, heartbeat_at = ? WHERE session_id = ?`).run(
        ...Object.values(updates),
        now,
        now,
        sessionID
      );
    } else {
      const defaults: SessionRow = {
        session_id: sessionID,
        project_id: project.id,
        directory: project.worktree,
        title: null,
        status: "idle",
        retry_message: null,
        retry_next: null,
        error_message: null,
        tmux_pane: tmuxPane,
        tmux_target: tmuxTarget,
        todo_total: 0,
        todo_done: 0,
        heartbeat_at: now,
        created_at: now,
        updated_at: now,
        ...updates,
      };
      db.query(
        `INSERT INTO sessions (
          session_id, project_id, directory, title, status,
          retry_message, retry_next, error_message, tmux_pane, tmux_target,
          todo_total, todo_done, heartbeat_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
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
        defaults.todo_total,
        defaults.todo_done,
        defaults.heartbeat_at,
        defaults.created_at,
        defaults.updated_at
      );
    }
  };

  const deleteSession = (sessionID: string) => {
    db.query("DELETE FROM sessions WHERE session_id = ?").run(sessionID);
    pendingPermissions.delete(sessionID);
    managedSessions.delete(sessionID);
  };

  const heartbeat = () => {
    const now = Date.now();
    for (const sessionID of managedSessions) {
      db.query("UPDATE sessions SET heartbeat_at = ? WHERE session_id = ?").run(now, sessionID);
    }
  };

  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL);

  process.on("exit", () => {
    clearInterval(heartbeatTimer);
    const now = Date.now();
    db.query("UPDATE sessions SET updated_at = ?").run(now);
    db.close();
  });

  return {
    event: async ({ event }: { event: Event }) => {
      debugLog(summarizeEvent(event as unknown as { type: string; properties: Record<string, unknown> }));
      switch (event.type) {
        case "session.status": {
          const { sessionID, status } = event.properties;
          if (status.type === "idle") {
            upsertSession(sessionID, { status: "idle", retry_message: null, retry_next: null });
          } else if (status.type === "busy") {
            upsertSession(sessionID, { status: "busy" });
          } else if (status.type === "retry") {
            upsertSession(sessionID, {
              status: "retry",
              retry_message: status.message,
              retry_next: status.next,
            });
          }
          break;
        }

        case "session.idle": {
          const { sessionID } = event.properties;
          upsertSession(sessionID, { status: "idle" });
          break;
        }

        case "session.created": {
          const { info } = event.properties;
          upsertSession(info.id, {
            project_id: info.projectID,
            directory: info.directory,
            title: info.title,
            status: "idle",
            created_at: info.time.created,
            updated_at: info.time.updated,
          });
          break;
        }

        case "session.updated": {
          const { info } = event.properties;
          upsertSession(info.id, {
            project_id: info.projectID,
            directory: info.directory,
            title: info.title,
            updated_at: info.time.updated,
          });
          break;
        }

        case "session.deleted": {
          const { info } = event.properties;
          deleteSession(info.id);
          break;
        }

        case "session.error": {
          const { sessionID, error } = event.properties;
          if (sessionID) {
            const errorMsg = error ? JSON.stringify(error) : null;
            upsertSession(sessionID, { status: "error", error_message: errorMsg });
          }
          break;
        }

        case "permission.updated": {
          const { sessionID, id } = event.properties;
          if (!pendingPermissions.has(sessionID)) {
            pendingPermissions.set(sessionID, new Set());
          }
          pendingPermissions.get(sessionID)!.add(id);
          upsertSession(sessionID, { status: "permission_pending" });
          break;
        }

        case "permission.replied": {
          const { sessionID, permissionID } = event.properties;
          const pending = pendingPermissions.get(sessionID);
          if (pending) {
            pending.delete(permissionID);
            if (pending.size === 0) {
              pendingPermissions.delete(sessionID);
              upsertSession(sessionID, { status: "idle" });
            }
          }
          break;
        }

        case "todo.updated": {
          const { sessionID, todos } = event.properties;
          const total = todos.length;
          const done = todos.filter((t) => t.status === "completed").length;
          upsertSession(sessionID, { todo_total: total, todo_done: done });
          break;
        }

        default:
          break;
      }
    },
  };
};

export default plugin;
