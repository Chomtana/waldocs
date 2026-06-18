import "server-only";
import { MemWal } from "@mysten-incubation/memwal";
import type { MemwalPort } from "./types";

const REMEMBER_TIMEOUT_MS = 60_000;

interface SdkClient {
  rememberAndWait(text: string, namespace?: string, opts?: { timeoutMs?: number }): Promise<{ blob_id: string }>;
  recall(params: { query: string; namespace?: string; limit?: number; maxDistance?: number }): Promise<{
    results: { blob_id: string; text: string; distance: number }[];
    total: number;
  }>;
  health(): Promise<{ status: string }>;
}

export function createMemwal(client: SdkClient): MemwalPort {
  return {
    async remember(text, namespace) {
      const r = await client.rememberAndWait(text, namespace, { timeoutMs: REMEMBER_TIMEOUT_MS });
      return { blobId: r.blob_id };
    },
    async recall(query, namespace, opts) {
      const r = await client.recall({ query, namespace, limit: opts?.limit, maxDistance: opts?.maxDistance });
      return { results: r.results.map((x) => ({ blobId: x.blob_id, text: x.text, distance: x.distance })) };
    },
    async health() {
      return await client.health();
    },
  };
}

// The staging relayer rate-limits per delegate key (~30 weighted req/min) and
// returns 429 with `retry_after_seconds`. Space calls out and back off on 429.
const MIN_GAP_MS = 2_200; // ≈27 req/min
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;

function parseRetryAfter(msg: string): number {
  const m = /retry_after_seconds["':\s]+(\d+)/i.exec(msg);
  return m ? Number(m[1]) : 60;
}

function rateLimited<T>(call: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await delay(wait);
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await call();
        lastAt = Date.now();
        return res;
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        if (/\b429\b|rate limit/i.test(msg) && attempt < 2) {
          await delay(parseRetryAfter(msg) * 1000 + 500);
          continue;
        }
        lastAt = Date.now();
        throw err;
      }
    }
  });
  chain = run.catch(() => {});
  return run;
}

function buildClient(): SdkClient {
  const raw = MemWal.create({
    key: process.env.MEMWAL_PRIVATE_KEY!,
    accountId: process.env.MEMWAL_ACCOUNT_ID!,
    serverUrl: process.env.MEMWAL_SERVER_URL ?? "https://relayer-staging.memory.walrus.xyz",
  }) as unknown as SdkClient;
  // Rate-limit the real relayer calls (createMemwal stays unthrottled for tests).
  return {
    rememberAndWait: (text, namespace, opts) => rateLimited(() => raw.rememberAndWait(text, namespace, opts)),
    recall: (params) => rateLimited(() => raw.recall(params)),
    health: () => raw.health(),
  };
}

let singleton: MemwalPort | null = null;
export function getMemwal(): MemwalPort {
  if (!singleton) singleton = createMemwal(buildClient());
  return singleton;
}
