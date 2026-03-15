import { resolve } from "node:path";
import type { Subprocess } from "bun";

export interface LLMockHandle {
  process: Subprocess;
  url: string;
  kill: () => Promise<void>;
}

const STARTUP_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 100;

export async function startLLMock(
  port: number,
  fixturesDir?: string,
): Promise<LLMockHandle> {
  const binPath = resolve("node_modules/.bin/llmock");
  const args = [binPath, "-p", String(port)];

  if (fixturesDir) {
    args.push("-f", fixturesDir);
  }

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const llmockUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let ready = false;

  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `llmock exited with code ${proc.exitCode} before becoming ready.\nstderr: ${stderr}`,
      );
    }

    try {
      const resp = await fetch(`${llmockUrl}/v1/_requests`);
      if (resp.ok) {
        ready = true;
        break;
      }
    } catch {}

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (!ready) {
    proc.kill();
    throw new Error(`llmock failed to become ready on port ${port} within ${STARTUP_TIMEOUT_MS}ms`);
  }

  const proxyPort = port + 1000;
  const proxy = Bun.serve({
    port: proxyPort,
    async fetch(req) {
      const url = new URL(req.url);
      let targetPath: string;
      if (url.pathname === "/messages") {
        targetPath = "/v1/messages";
      } else {
        targetPath = url.pathname + url.search;
      }
      const targetUrl = `${llmockUrl}${targetPath}`;
      const proxyReq = new Request(targetUrl, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        duplex: "half",
      } as RequestInit & { duplex: string });
      return fetch(proxyReq);
    },
  });

  const proxyUrl = `http://127.0.0.1:${proxyPort}`;

  const kill = async () => {
    proxy.stop(true);
    proc.kill();
    await proc.exited;
  };

  return { process: proc, url: proxyUrl, kill };
}

export async function stopLLMock(handle: LLMockHandle): Promise<void> {
  await handle.kill();
}

export async function getLLMockRequests(url: string): Promise<unknown[]> {
  const journalUrl = url.replace(/:(\d+)/, (_, p) => `:${Number(p) - 1000}`);
  const resp = await fetch(`${journalUrl}/v1/_requests`);
  if (!resp.ok) {
    throw new Error(
      `Failed to fetch llmock requests: ${resp.status} ${resp.statusText}`,
    );
  }
  return resp.json();
}
