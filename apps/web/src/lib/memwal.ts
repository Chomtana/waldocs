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

function buildClient(): SdkClient {
  return MemWal.create({
    key: process.env.MEMWAL_PRIVATE_KEY!,
    accountId: process.env.MEMWAL_ACCOUNT_ID!,
    serverUrl: process.env.MEMWAL_SERVER_URL ?? "https://relayer-staging.memory.walrus.xyz",
  }) as unknown as SdkClient;
}

let singleton: MemwalPort | null = null;
export function getMemwal(): MemwalPort {
  if (!singleton) singleton = createMemwal(buildClient());
  return singleton;
}
