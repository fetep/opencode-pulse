import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createTestDb,
  queryTestDb,
  type SessionRow,
  type TestDbHandle,
  waitForDbRow,
} from "../helpers/db.ts";
import { type LLMockHandle, startLLMock, stopLLMock } from "../helpers/llmock.ts";
import {
  createSession,
  type OpenCodeHandle,
  sendMessage,
  startOpenCode,
  stopOpenCode,
} from "../helpers/opencode.ts";

const LLMOCK_PORT = 15_555;
const OC_PORT = 14_096;
const PLUGIN_PATH = resolve("./plugin/dist/index.js");
const FIXTURES_DIR = resolve("./test/fixtures");

async function waitForRow(
  dbPath: string,
  predicate: (row: SessionRow) => boolean,
  timeoutMs: number,
  label: string,
): Promise<SessionRow> {
  try {
    return await waitForDbRow(dbPath, predicate, timeoutMs);
  } catch {
    const rows = queryTestDb(dbPath);
    const state =
      rows.length > 0 ? JSON.stringify(rows[0], null, 2) : "(no rows)";
    throw new Error(`Timeout waiting for: ${label}\nCurrent DB row:\n${state}`);
  }
}

const shouldRun = !!process.env.INTEGRATION;

(shouldRun ? describe : describe.skip)(
  "Plugin→DB Integration",
  () => {
    let llmockHandle: LLMockHandle;
    let ocHandle: OpenCodeHandle;
    let testDb: TestDbHandle;
    let workdir: string;

    beforeAll(async () => {
      workdir = mkdtempSync(`${tmpdir()}/pulse-int-workdir-`);
      testDb = createTestDb();
      llmockHandle = await startLLMock(LLMOCK_PORT, FIXTURES_DIR);
      ocHandle = await startOpenCode({
        port: OC_PORT,
        dbPath: testDb.dbPath,
        llmockUrl: `${llmockHandle.url}/v1`,
        pluginPath: PLUGIN_PATH,
        workdir,
      });
    }, 60_000);

    afterAll(async () => {
      try {
        if (ocHandle) await ocHandle.kill();
      } catch {}
      try {
        if (llmockHandle) await stopLLMock(llmockHandle);
      } catch {}
      try {
        if (testDb) testDb.cleanup();
      } catch {}
      try {
        if (workdir) rmSync(workdir, { recursive: true, force: true });
      } catch {}
    });

    it("creates DB row on startup with idle status", () => {
      const rows = queryTestDb(testDb.dbPath);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].status).toBe("idle");
      expect(rows[0].pid).toBe(ocHandle.pid);
    });

    it("populates directory and timestamps in initial row", () => {
      const rows = queryTestDb(testDb.dbPath);
      const row = rows[0];
      expect(row.directory).toBeTruthy();
      expect(row.heartbeat_at).toBeGreaterThan(0);
      expect(row.created_at).toBeGreaterThan(0);
      expect(row.updated_at).toBeGreaterThan(0);
    });

    it("session_id, version, and title set after session creation", async () => {
      const sessionId = await createSession(ocHandle.url);
      await sendMessage(ocHandle.url, sessionId, "pulse-test-simple");

      const row = await waitForRow(
        testDb.dbPath,
        (r) => r.session_id !== "" && r.opencode_version !== "",
        15_000,
        "session_id and version set",
      );
      expect(row.session_id).toBeTruthy();
      expect(row.opencode_version).toBe("1.2.26");
      expect(row.title).toBeTruthy();
    }, 20_000);

    it("updated_at advances after message processing", async () => {
      const sessionId = await createSession(ocHandle.url);

      const afterCreate = await waitForRow(
        testDb.dbPath,
        (r) => r.session_id !== "",
        5_000,
        "session_id set from session.created",
      );
      const createUpdated = afterCreate.updated_at;

      await sendMessage(ocHandle.url, sessionId, "pulse-test-simple");

      const row = await waitForRow(
        testDb.dbPath,
        (r) => r.status === "idle" && r.updated_at > createUpdated,
        15_000,
        "idle with updated_at > createSession timestamp",
      );
      expect(row.updated_at).toBeGreaterThan(createUpdated);
    }, 25_000);

    it("error_message populated when LLM returns error", async () => {
      const sessionId = await createSession(ocHandle.url);
      const baseUpdated = queryTestDb(testDb.dbPath)[0]?.updated_at ?? 0;

      await sendMessage(ocHandle.url, sessionId, "pulse-test-error");

      const row = await waitForRow(
        testDb.dbPath,
        (r) => r.updated_at > baseUpdated && r.error_message !== "",
        15_000,
        "error_message set after LLM error",
      );
      expect(row.error_message).toBeTruthy();
      expect(row.error_message).toContain("APIError");
    }, 20_000);

    it("session_id updates when creating a new session", async () => {
      const prevSessionId = queryTestDb(testDb.dbPath)[0]?.session_id ?? "";

      const newSessionId = await createSession(ocHandle.url);
      await sendMessage(ocHandle.url, newSessionId, "pulse-test-simple");

      const row = await waitForRow(
        testDb.dbPath,
        (r) => r.session_id !== prevSessionId && r.session_id !== "",
        10_000,
        "session_id changed after new session",
      );
      expect(row.session_id).not.toBe(prevSessionId);
    }, 15_000);

    it("multiple sessions maintain single DB row per PID", async () => {
      await createSession(ocHandle.url);
      await createSession(ocHandle.url);

      const rows = queryTestDb(testDb.dbPath);
      const pidRows = rows.filter((r) => r.pid === ocHandle.pid);
      expect(pidRows.length).toBe(1);
    }, 10_000);

    it("error_message persists after recovery to idle", () => {
      const row = queryTestDb(testDb.dbPath)[0];
      expect(row.error_message).toBeTruthy();
      expect(row.status).toBe("idle");
    });

    it("bash tool use executes with auto-approved permission", async () => {
      const sessionId = await createSession(ocHandle.url);
      const before = await waitForRow(
        testDb.dbPath,
        (r) => r.session_id === sessionId,
        10_000,
        "session created in DB",
      );
      sendMessage(ocHandle.url, sessionId, "pulse-test-bash").catch(() => {});
      const row = await waitForRow(
        testDb.dbPath,
        (r) => r.updated_at > before.updated_at,
        15_000,
        "updated_at advances after bash tool execution",
      );
      expect(row.session_id).toBeTruthy();
    }, 25_000);

    it("todo write tool updates todo counts", async () => {
      const sessionId = await createSession(ocHandle.url);
      const prevTodoTotal = queryTestDb(testDb.dbPath)[0]?.todo_total ?? 0;
      sendMessage(ocHandle.url, sessionId, "pulse-test-todo").catch(() => {});
      const row = await waitForRow(
        testDb.dbPath,
        (r) => r.todo_total > prevTodoTotal,
        20_000,
        "todo_total increases after todowrite tool call",
      );
      expect(row.todo_total).toBeGreaterThan(0);
    }, 25_000);

    it("rate limit response sets retry status", async () => {
      const sessionId = await createSession(ocHandle.url);
      sendMessage(ocHandle.url, sessionId, "pulse-test-ratelimit").catch(() => {});
      const row = await waitForRow(
        testDb.dbPath,
        (r) => r.retry_message !== "",
        20_000,
        "retry_message set after 429 rate limit response",
      );
      expect(row.retry_message).toBeTruthy();
      expect(row.retry_next).toBeGreaterThan(0);
    }, 25_000);

    it("row deleted when opencode stops", async () => {
      const rows = queryTestDb(testDb.dbPath);
      expect(rows.length).toBeGreaterThan(0);
      const { pid } = rows[0];

      await stopOpenCode(ocHandle);

      let deleted = false;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const current = queryTestDb(testDb.dbPath);
        if (!current.find((r) => r.pid === pid)) {
          deleted = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      if (!deleted) {
        let alive = true;
        try {
          process.kill(pid, 0);
        } catch {
          alive = false;
        }
        expect(alive).toBe(false);
      }
    }, 15_000);
  },
);
