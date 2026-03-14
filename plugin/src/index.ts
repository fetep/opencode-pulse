import { Database } from "bun:sqlite";
import { readFileSync, appendFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { parse as parseJsonc } from "jsonc-parser";
import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const CONFIG_PATHS = [join(CONFIG_DIR, "pulse.jsonc"), join(CONFIG_DIR, "pulse.json")];
const SCHEMA_PATH = join(import.meta.dir, "../../schema.sql");
const HEARTBEAT_INTERVAL = 10000;
const DEBUG_LOG = join(homedir(), ".local/share/opencode-pulse/debug.log");

const ALLOWED_UPDATE_COLUMNS = new Set([
  "session_id", "project_id", "directory", "title", "status",
  "retry_message", "retry_next", "error_message", "tmux_pane",
  "tmux_target", "opencode_version", "todo_total", "todo_done",
]);

const MAX_FIELD_LEN = 4096;

function truncStr(val: unknown, maxLen = MAX_FIELD_LEN): string | null {
  if (val == null) return null;
  const s = String(val);
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function loadPluginConfig(): { debug?: boolean; dbPath?: string } {
  for (const path of CONFIG_PATHS) {
    if (!existsSync(path)) continue;
    try {
      return parseJsonc(readFileSync(path, "utf-8"));
    } catch {
      continue;
    }
  }
  return {};
}

const pluginConfig = loadPluginConfig();
const DEBUG_ENABLED = process.env.PULSE_DEBUG === "true" || process.env.PULSE_DEBUG === "1" || pluginConfig.debug === true;
const DB_PATH = process.env.PULSE_DB_PATH || pluginConfig.dbPath || join(homedir(), ".local/share/opencode-pulse/status.db");

function debugLog(msg: string) {
  if (!DEBUG_ENABLED) return;
  try {
    appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] [pid=${process.pid}] ${msg}\n`, { mode: 0o600 });
  } catch {}
}

export interface CmdlineFlags {
  sessionId: string | null;  // from -s <id>
  continueMode: boolean;     // from -c / --continue
}

export function parseCmdlineFlags(providedArgs?: string[]): CmdlineFlags {
  let args: string[];
  if (providedArgs) {
    args = providedArgs;
  } else {
    try {
      args = readFileSync("/proc/self/cmdline", "utf-8").split("\0");
    } catch {
      return { sessionId: null, continueMode: false };
    }
  }
  const sIdx = args.indexOf("-s");
  const sessionId = (sIdx !== -1 && sIdx + 1 < args.length && args[sIdx + 1]) ? args[sIdx + 1] : null;
  const continueMode = args.includes("-c") || args.includes("--continue");
  return { sessionId, continueMode };
}

export function summarizeEvent(event: { type: string; properties: Record<string, unknown> }): string {
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
      const result = await input.$`tmux display-message -p -t ${tmuxPane} '#{session_name}'`.text();
      tmuxTarget = result.trim() || null;
    } catch {
      tmuxTarget = null;
    }
  }

  const dbDir = join(homedir(), ".local/share/opencode-pulse");
  mkdirSync(dbDir, { recursive: true, mode: 0o700 });

  const db = new Database(DB_PATH);
  chmodSync(DB_PATH, 0o600);
  if (existsSync(DEBUG_LOG)) chmodSync(DEBUG_LOG, 0o600);

  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);

  db.exec("PRAGMA journal_mode = WAL");

  // SQLite WAL mode creates two auxiliary files that also contain DB data
  const shmPath = DB_PATH + "-shm";
  const walPath = DB_PATH + "-wal";
  if (existsSync(shmPath)) chmodSync(shmPath, 0o600);
  if (existsSync(walPath)) chmodSync(walPath, 0o600);

  const versionRow = db.query("SELECT version FROM schema_version").get() as { version: number } | null;
  if (!versionRow || versionRow.version !== 3) {
    throw new Error(`Schema version mismatch: expected 3, got ${versionRow?.version}`);
  }

  const pendingPermissions = new Set<string>();
  const pendingQuestions = new Set<string>();
  let sessionFromEvent = false;
  const { sessionId: cmdlineSessionId, continueMode } = parseCmdlineFlags();
  debugLog(`startup: tmuxPane=${tmuxPane} dir=${project.worktree} cmdlineSession=${cmdlineSessionId} continue=${continueMode}`);

  const upsertProcess = (updates: Partial<Omit<SessionRow, "pid">>) => {
    const now = Date.now();
    const existing = db
      .query("SELECT * FROM sessions WHERE pid = ?")
      .get(pid) as SessionRow | null;

    if (existing) {
      const entries = Object.entries(updates).filter(([k]) => ALLOWED_UPDATE_COLUMNS.has(k));
      if (entries.length > 0) {
        const fields = entries.map(([k]) => `${k} = ?`).join(", ");
        db.query(`UPDATE sessions SET ${fields}, updated_at = ?, heartbeat_at = ? WHERE pid = ?`).run(
          ...entries.map(([, v]) => v),
          now,
          now,
          pid,
        );
      } else {
        db.query("UPDATE sessions SET updated_at = ?, heartbeat_at = ? WHERE pid = ?").run(now, now, pid);
      }
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

  const heartbeat = () => {
    const now = Date.now();
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

      if (continueMode) {
        const { data: sessions } = await input.client.session.list({
          query: { directory: project.worktree },
        });
        if (sessions && sessions.length > 0) {
          const session = sessions[0];
          upsertProcess({
            session_id: session.id,
            project_id: session.projectID,
            directory: session.directory,
            title: session.title,
            opencode_version: session.version,
          });
          debugLog(`adopt: continue session id=${session.id} title="${session.title}"`);
        } else {
          debugLog("adopt: continue mode but no sessions found");
        }
        return;
      }

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
            upsertProcess({ session_id: truncStr(sessionID), status: "idle", retry_message: null, retry_next: null });
          } else if (status.type === "busy") {
            upsertProcess({ session_id: truncStr(sessionID), status: "busy" });
          } else if (status.type === "retry") {
            upsertProcess({
              session_id: truncStr(sessionID),
              status: "retry",
              retry_message: truncStr(status.message),
              retry_next: status.next,
            });
          }
          break;
        }

        case "session.idle": {
          const { sessionID } = event.properties;
          upsertProcess({ session_id: truncStr(sessionID), status: "idle" });
          break;
        }

        case "session.created": {
          const { info } = event.properties;
          upsertProcess({
            session_id: truncStr(info.id),
            project_id: truncStr(info.projectID),
            directory: truncStr(info.directory),
            title: truncStr(info.title),
            opencode_version: truncStr(info.version),
            status: "idle",
          });
          break;
        }

        case "session.updated": {
          const { info } = event.properties;
          upsertProcess({
            session_id: truncStr(info.id),
            project_id: truncStr(info.projectID),
            directory: truncStr(info.directory),
            title: truncStr(info.title),
            opencode_version: truncStr(info.version),
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
          upsertProcess({ session_id: truncStr(sessionID), status: "error", error_message: truncStr(errorMsg) });
          break;
        }

        case "permission.replied": {
          // SDK types define 'permissionID' but runtime sends 'requestID'
          const props = event.properties as Record<string, string>;
          const permId = props.requestID || props.permissionID;
          pendingPermissions.delete(permId);
          if (pendingPermissions.size === 0) {
            upsertProcess({ status: pendingQuestions.size > 0 ? "question_pending" : "idle" });
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

        default: {
          // SDK types don't include permission.asked, question.asked, or question.replied
          const ev = event as unknown as { type: string; properties: Record<string, string> };
          if (ev.type === "permission.asked") {
            pendingPermissions.add(ev.properties.id);
            upsertProcess({ status: "permission_pending" });
          } else if (ev.type === "question.asked") {
            pendingQuestions.add(ev.properties.id);
            if (pendingPermissions.size === 0) {
              upsertProcess({ status: "question_pending" });
            }
          } else if (ev.type === "question.replied") {
            const qId = ev.properties.requestID || ev.properties.id;
            pendingQuestions.delete(qId);
            if (pendingQuestions.size === 0 && pendingPermissions.size === 0) {
              upsertProcess({ status: "idle" });
            }
          }
          break;
        }
      }
    },
  };
};

export default plugin;
