import { Database } from "bun:sqlite";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";
import { parse as parseJsonc } from "jsonc-parser";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const CONFIG_PATHS = [join(CONFIG_DIR, "pulse.jsonc"), join(CONFIG_DIR, "pulse.json")];
const SCHEMA_PATH = join(import.meta.dir, "../../schema.sql");
const HEARTBEAT_INTERVAL = 10000;
const DEBUG_LOG = join(homedir(), ".local/share/opencode-pulse/debug.log");

const ALLOWED_UPDATE_COLUMNS = new Set([
  "session_id", "project_id", "directory", "title", "status",
  "retry_message", "retry_next", "error_message", "tmux_pane",
  "tmux_target", "opencode_version", "todo_total", "todo_done",
  "subagent_count", "session_started_at",
]);

const MAX_FIELD_LEN = 4096;

function truncStr(val: unknown, maxLen = MAX_FIELD_LEN): string | null {
  if (val == null) return null;
  const s = String(val);
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function toMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

function loadPluginConfig(): { debug?: boolean; dbPath?: string } {
  for (const configPath of CONFIG_PATHS) {
    if (!existsSync(configPath)) continue;
    return parseJsonc(readFileSync(configPath, "utf-8"));
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

export const LATEST_VERSION = 4;

// Ordered migrations. Each entry upgrades from (version-1) to version.
// Future migrations:
//   { version: 5, sql: "ALTER TABLE sessions ADD COLUMN cost REAL DEFAULT 0" },
export const MIGRATIONS: { version: number; sql: string }[] = [
  // v1→v2: primary key changed from session_id TEXT to pid INTEGER.
  // No data migration possible — sessions are ephemeral (running processes).
  {
    version: 2,
    sql: `
      DROP TABLE IF EXISTS sessions;
      CREATE TABLE sessions (
        pid INTEGER PRIMARY KEY,
        session_id TEXT,
        project_id TEXT,
        directory TEXT,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        retry_message TEXT,
        retry_next INTEGER,
        error_message TEXT,
        tmux_pane TEXT,
        tmux_target TEXT,
        todo_total INTEGER NOT NULL DEFAULT 0,
        todo_done INTEGER NOT NULL DEFAULT 0,
        heartbeat_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_heartbeat ON sessions(heartbeat_at);
    `,
  },
  {
    version: 3,
    sql: "ALTER TABLE sessions ADD COLUMN opencode_version TEXT",
  },
  {
    version: 4,
    sql: `
      ALTER TABLE sessions ADD COLUMN subagent_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN session_started_at INTEGER;
    `,
  },
];

export function getSchemaVersion(db: Database): number {
  try {
    const tables = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).all();
    if (tables.length === 0) return 0;
    // MAX(version) works for both old format (version as PK) and new format (id + version)
    const row = db.query("SELECT MAX(version) as version FROM schema_version").get() as { version: number } | null;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

// Ensure all v4 columns exist (for legacy DBs without version tracking)
function ensureColumns(db: Database): void {
  const tableInfo = db.query("PRAGMA table_info(sessions)").all() as { name: string }[];
  const columns = new Set(tableInfo.map(c => c.name));
  if (!columns.has("opencode_version")) {
    db.exec("ALTER TABLE sessions ADD COLUMN opencode_version TEXT");
  }
  if (!columns.has("subagent_count")) {
    db.exec("ALTER TABLE sessions ADD COLUMN subagent_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.has("session_started_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN session_started_at INTEGER");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_heartbeat ON sessions(heartbeat_at)");
}

// v1-v3 used `version INTEGER PRIMARY KEY`; v4+ uses `id INTEGER PRIMARY KEY, version INTEGER`
function upgradeSchemaVersionTable(db: Database, version: number): void {
  const cols = db.query("PRAGMA table_info(schema_version)").all() as { name: string }[];
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has("id")) {
    db.exec("DROP TABLE schema_version");
    db.exec(`
      CREATE TABLE schema_version (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        version INTEGER NOT NULL
      );
    `);
  }
  db.exec(
    `INSERT INTO schema_version (id, version) VALUES (1, ${version})
       ON CONFLICT(id) DO UPDATE SET version = excluded.version`
  );
}

export function migrateDb(db: Database): void {
  const current = getSchemaVersion(db);
  if (current >= LATEST_VERSION) return;

  if (current === 0) {
    const tables = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
    ).all();
    if (tables.length === 0) {
      const schema = readFileSync(SCHEMA_PATH, "utf-8");
      db.exec(schema);
      debugLog(`migrate: fresh database, created at v${LATEST_VERSION}`);
      return;
    }
    // Legacy DB: sessions table exists but no version tracking.
    // Bring columns up to date and stamp the version.
    ensureColumns(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        version INTEGER NOT NULL
      );
    `);
    upgradeSchemaVersionTable(db, LATEST_VERSION);
    debugLog(`migrate: legacy database upgraded to v${LATEST_VERSION}`);
    return;
  }

  for (const m of MIGRATIONS) {
    if (m.version > current && m.version <= LATEST_VERSION) {
      db.exec(m.sql);
      debugLog(`migrate: applied v${m.version}`);
    }
  }
  upgradeSchemaVersionTable(db, LATEST_VERSION);
  debugLog(`migrate: upgraded from v${current} to v${LATEST_VERSION}`);
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
  subagent_count: number;
  session_started_at: number | null;
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

  const dbDir = dirname(DB_PATH);
  mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  chmodSync(dbDir, 0o700);

  const db = new Database(DB_PATH);
  chmodSync(DB_PATH, 0o600);
  if (existsSync(DEBUG_LOG)) chmodSync(DEBUG_LOG, 0o600);

  migrateDb(db);

  db.exec("PRAGMA journal_mode = WAL");

  // Force WAL/SHM file creation so we can set permissions immediately.
  // migrateDb may skip writes on an up-to-date DB, so we need a real
  // write to guarantee WAL frames are created.
  db.exec(`INSERT INTO schema_version (id, version) VALUES (1, ${LATEST_VERSION}) ON CONFLICT(id) DO UPDATE SET version = excluded.version`);
  const shmPath = `${DB_PATH}-shm`;
  const walPath = `${DB_PATH}-wal`;
  chmodSync(shmPath, 0o600);
  chmodSync(walPath, 0o600);

  const pendingPermissions = new Set<string>();
  const pendingQuestions = new Set<string>();
  let sessionFromEvent = false;
  const { sessionId: cmdlineSessionId, continueMode } = parseCmdlineFlags();
  let mainSessionId: string | null = cmdlineSessionId;
  const knownSubagents = new Set<string>();
  const activeSubagents = new Set<string>();
  let sessionStartedAtSet = false;
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
        subagent_count: 0,
        session_started_at: null,
        heartbeat_at: now,
        created_at: now,
        updated_at: now,
        ...updates,
      };
      db.query(
        `INSERT INTO sessions (
          pid, session_id, project_id, directory, title, status,
          retry_message, retry_next, error_message, tmux_pane, tmux_target,
          opencode_version, todo_total, todo_done, subagent_count, session_started_at,
          heartbeat_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        defaults.subagent_count,
        defaults.session_started_at,
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
          mainSessionId = session.id;
          sessionStartedAtSet = true;
          upsertProcess({
            session_id: session.id,
            project_id: session.projectID,
            directory: session.directory,
            title: session.title,
            opencode_version: session.version,
            session_started_at: session.time?.created
              ? toMs(session.time.created)
              : Date.now(),
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
          mainSessionId = session.id;
          sessionStartedAtSet = true;
          upsertProcess({
            session_id: session.id,
            project_id: session.projectID,
            directory: session.directory,
            title: session.title,
            opencode_version: session.version,
            session_started_at: session.time?.created
              ? toMs(session.time.created)
              : Date.now(),
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
      const activeId = ids.find((id) => statuses?.[id].type === "busy" || statuses?.[id].type === "idle");
      if (!activeId) return;
      const { data: sessions } = await input.client.session.list({
        query: { directory: project.worktree },
      });
      const session = sessions?.find((s) => s.id === activeId);
      if (session) {
        mainSessionId = session.id;
        sessionStartedAtSet = true;
        upsertProcess({
          session_id: session.id,
          project_id: session.projectID,
          directory: session.directory,
          title: session.title,
          opencode_version: session.version,
          session_started_at: session.time?.created
            ? toMs(session.time.created)
            : Date.now(),
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
          const sid = truncStr(sessionID);

          if (sid && knownSubagents.has(sid)) {
            if (status.type === "busy") {
              activeSubagents.add(sid);
            } else {
              activeSubagents.delete(sid);
            }
            upsertProcess({ subagent_count: activeSubagents.size });
          } else {
            if (sid && !mainSessionId) mainSessionId = sid;
            const updates: Partial<Omit<SessionRow, "pid">> = { session_id: sid };
            if (!sessionStartedAtSet && sid) {
              sessionStartedAtSet = true;
              updates.session_started_at = Date.now();
            }
            if (status.type === "idle") {
              updates.status = "idle";
              updates.retry_message = null;
              updates.retry_next = null;
            } else if (status.type === "busy") {
              updates.status = "busy";
            } else if (status.type === "retry") {
              updates.status = "retry";
              updates.retry_message = truncStr(status.message);
              updates.retry_next = status.next;
            }
            upsertProcess(updates);
          }
          break;
        }

        case "session.idle": {
          const { sessionID } = event.properties;
          const sid = truncStr(sessionID);

          if (sid && knownSubagents.has(sid)) {
            activeSubagents.delete(sid);
            upsertProcess({ subagent_count: activeSubagents.size });
          } else {
            if (sid && !mainSessionId) mainSessionId = sid;
            const updates: Partial<Omit<SessionRow, "pid">> = { session_id: sid, status: "idle" };
            if (!sessionStartedAtSet && sid) {
              sessionStartedAtSet = true;
              updates.session_started_at = Date.now();
            }
            upsertProcess(updates);
          }
          break;
        }

        case "session.created": {
          const { info } = event.properties;
          const sid = truncStr(info.id);

          if (info.parentID) {
            if (sid) knownSubagents.add(sid);
            debugLog(`subagent created: ${sid} parent=${info.parentID}`);
          } else {
            mainSessionId = sid;
            const updates: Partial<Omit<SessionRow, "pid">> = {
              session_id: sid,
              project_id: truncStr(info.projectID),
              directory: truncStr(info.directory),
              title: truncStr(info.title),
              opencode_version: truncStr(info.version),
              status: "idle",
            };
            if (!sessionStartedAtSet) {
              sessionStartedAtSet = true;
              updates.session_started_at = info.time?.created
                ? toMs(info.time.created)
                : Date.now();
            }
            upsertProcess(updates);
          }
          break;
        }

        case "session.updated": {
          const { info } = event.properties;
          const sid = truncStr(info.id);

          if (info.parentID || (sid && knownSubagents.has(sid))) {
            if (sid) knownSubagents.add(sid);
            break;
          }

          mainSessionId = sid;
          const updates: Partial<Omit<SessionRow, "pid">> = {
            session_id: sid,
            project_id: truncStr(info.projectID),
            directory: truncStr(info.directory),
            title: truncStr(info.title),
            opencode_version: truncStr(info.version),
          };
          if (!sessionStartedAtSet && info.time?.created) {
            sessionStartedAtSet = true;
            updates.session_started_at = toMs(info.time.created);
          }
          upsertProcess(updates);
          break;
        }

        case "session.deleted": {
          const { info } = event.properties;
          const sid = truncStr(info?.id);

          if (sid && (info?.parentID || knownSubagents.has(sid))) {
            knownSubagents.delete(sid);
            activeSubagents.delete(sid);
            upsertProcess({ subagent_count: activeSubagents.size });
          } else {
            mainSessionId = null;
            sessionStartedAtSet = false;
            activeSubagents.clear();
            knownSubagents.clear();
            upsertProcess({
              session_id: null,
              title: null,
              status: "idle",
              todo_total: 0,
              todo_done: 0,
              subagent_count: 0,
              session_started_at: null,
            });
          }
          break;
        }

        case "session.error": {
          const { sessionID, error } = event.properties;
          const sid = truncStr(sessionID);

          if (sid && knownSubagents.has(sid)) {
            activeSubagents.delete(sid);
            upsertProcess({ subagent_count: activeSubagents.size });
          } else {
            if (sid && !mainSessionId) mainSessionId = sid;
            const errorMsg = error ? JSON.stringify(error) : null;
            upsertProcess({ session_id: sid, status: "error", error_message: truncStr(errorMsg) });
          }
          break;
        }

        case "permission.replied": {
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
