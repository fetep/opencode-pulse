-- Schema version 4: add subagent tracking and session age
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

INSERT OR IGNORE INTO schema_version (version) VALUES (4);

CREATE TABLE IF NOT EXISTS sessions (
    pid                INTEGER PRIMARY KEY,
    session_id         TEXT,
    project_id         TEXT,
    directory          TEXT,
    title              TEXT,
    status             TEXT NOT NULL DEFAULT 'idle',
    retry_message      TEXT,
    retry_next         INTEGER,
    error_message      TEXT,
    tmux_pane          TEXT,
    tmux_target        TEXT,
    opencode_version   TEXT,
    todo_total         INTEGER NOT NULL DEFAULT 0,
    todo_done          INTEGER NOT NULL DEFAULT 0,
    subagent_count     INTEGER NOT NULL DEFAULT 0,
    session_started_at INTEGER,
    heartbeat_at       INTEGER NOT NULL,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_heartbeat ON sessions(heartbeat_at);
