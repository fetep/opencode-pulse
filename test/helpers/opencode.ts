import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";


export interface OpenCodeHandle {
  process: ReturnType<typeof Bun.spawn>;
  url: string;
  pid: number;
  dbPath: string;
  kill: () => Promise<void>;
}

export interface OpenCodeOptions {
  port: number;
  dbPath: string;
  llmockUrl: string;
  pluginPath: string;
  workdir: string;
}

const HTTP_READY_TIMEOUT_MS = 30_000;
const HTTP_POLL_INTERVAL_MS = 500;
const DB_READY_TIMEOUT_MS = 30_000;
const DB_POLL_INTERVAL_MS = 200;
const STOP_TIMEOUT_MS = 5_000;
const SSE_DEFAULT_TIMEOUT_MS = 30_000;

export async function startOpenCode(
  options: OpenCodeOptions,
): Promise<OpenCodeHandle> {
  if (!existsSync(options.pluginPath)) {
    throw new Error("Plugin not built: run 'bun run build' first");
  }

  const homeDir = mkdtempSync(join(tmpdir(), "pulse-test-home-"));
  const configDir = join(homeDir, ".config");
  const opencodeConfigDir = join(configDir, "opencode");
  mkdirSync(opencodeConfigDir, { recursive: true });
  writeFileSync(
    join(opencodeConfigDir, "opencode.json"),
    JSON.stringify({
      model: "anthropic/claude-sonnet-4-5",
      plugin: [options.pluginPath],
    }),
  );

  const env: Record<string, string> = {
    HOME: homeDir,
    PATH: process.env.PATH ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    XDG_CONFIG_HOME: configDir,
    ANTHROPIC_BASE_URL: options.llmockUrl,
    ANTHROPIC_API_KEY: "mock-key",
    OPENCODE_PERMISSION: '{"*":"allow"}',
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
    PULSE_DB_PATH: options.dbPath,
    PULSE_DEBUG: "true",
  };

  const proc = Bun.spawn(
    ["opencode", "serve", "--port", String(options.port)],
    {
      env,
      cwd: options.workdir,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const url = `http://127.0.0.1:${options.port}`;

  const handle: OpenCodeHandle = {
    process: proc,
    url,
    pid: proc.pid,
    dbPath: options.dbPath,
    kill: async () => {
      await stopOpenCode(handle);
      try {
        rmSync(homeDir, { recursive: true, force: true });
      } catch {}
    },
  };

  let httpReady = false;
  const httpDeadline = Date.now() + HTTP_READY_TIMEOUT_MS;

  while (Date.now() < httpDeadline) {
    if (proc.exitCode !== null) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `opencode exited with code ${proc.exitCode} before becoming ready.\nstderr: ${stderr}`,
      );
    }
    try {
      const resp = await fetch(`${url}/session`);
      if (resp.ok) {
        httpReady = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, HTTP_POLL_INTERVAL_MS));
  }

  if (!httpReady) {
    await handle.kill();
    throw new Error(
      `opencode failed to become HTTP-ready on port ${options.port} within ${HTTP_READY_TIMEOUT_MS}ms`,
    );
  }

  let dbReady = false;
  const dbDeadline = Date.now() + DB_READY_TIMEOUT_MS;

  while (Date.now() < dbDeadline) {
    try {
      if (existsSync(options.dbPath)) {
        const db = new Database(options.dbPath, { readonly: true });
        try {
          const row = db.query("SELECT * FROM sessions LIMIT 1").get();
          if (row) {
            dbReady = true;
            break;
          }
        } finally {
          db.close();
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, DB_POLL_INTERVAL_MS));
  }

  if (!dbReady) {
    await handle.kill();
    throw new Error(
      `Plugin did not write heartbeat row to ${options.dbPath} within ${DB_READY_TIMEOUT_MS}ms`,
    );
  }

  // The opencode server may run as a child process with a different PID
  // (e.g. when installed via bun global shim). Read the actual PID.
  const pidDb = new Database(options.dbPath, { readonly: true });
  try {
    const row = pidDb.query("SELECT pid FROM sessions LIMIT 1").get() as { pid: number } | null;
    if (row) handle.pid = row.pid;
  } finally {
    pidDb.close();
  }

  return handle;
}

export async function stopOpenCode(handle: OpenCodeHandle): Promise<void> {
  const { process: proc } = handle;
  if (proc.exitCode !== null) return;

  const serverPid = handle.pid !== proc.pid ? handle.pid : null;

  if (serverPid) {
    try { process.kill(serverPid, "SIGTERM"); } catch {}
  }
  proc.kill("SIGTERM");

  const result = await Promise.race([
    proc.exited.then(() => "exited" as const),
    new Promise<"timeout">((r) => setTimeout(() => r("timeout"), STOP_TIMEOUT_MS)),
  ]);

  if (result === "timeout" && proc.exitCode === null) {
    proc.kill("SIGKILL");
    await proc.exited;
  }

  if (serverPid) {
    for (let i = 0; i < 20; i++) {
      try { process.kill(serverPid, 0); } catch { return; }
      await new Promise((r) => setTimeout(r, 100));
    }
    try { process.kill(serverPid, "SIGKILL"); } catch {}
  }
}

export async function createSession(url: string): Promise<string> {
  const resp = await fetch(`${url}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Failed to create session: ${resp.status} ${resp.statusText}\n${body}`,
    );
  }

  const data = (await resp.json()) as { id: string };
  return data.id;
}

export async function sendMessage(
  url: string,
  sessionId: string,
  text: string,
): Promise<void> {
  const resp = await fetch(`${url}/session/${sessionId}/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parts: [{ type: "text", text }] }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Failed to send message: ${resp.status} ${resp.statusText}\n${body}`,
    );
  }
}

// SSE wire format: "data: <json>\n\n" — event JSON has a `type` field
export async function waitForEvent(
  url: string,
  eventType: string,
  timeoutMs: number = SSE_DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${url}/global/event`, {
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(
        `SSE connect failed: ${resp.status} ${resp.statusText}`,
      );
    }

    if (!resp.body) {
      throw new Error("SSE response has no body");
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6);
          try {
            const event = JSON.parse(json);
            if (event.type === eventType) {
              reader.cancel();
              return event;
            }
          } catch {}
        }
      }
    }

    throw new Error(
      `SSE stream ended without receiving event type "${eventType}"`,
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `Timeout waiting for SSE event "${eventType}" after ${timeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
