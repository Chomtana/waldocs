# waldocs — App Doc

> App-doc source for `Chomtana/waldocs`. This is the step-by-step guide that the
> `waldocs-publish` skill would send to the backend (kept here as a file, unpublished).

## Environment

- walrus: `@mysten-incubation/memwal@0.0.7` (Node / TypeScript)
- sui: `@mysten/sui@2.19.0`
- seal: `@mysten/seal@1.2.0`

> Exact SDK packages/versions this guide was written and verified against. Everything targets Sui **testnet** and the Walrus Memory **staging** relayer.

## Step 1: Install the SDKs

Walrus Memory (MemWal) is the AI-agent memory layer over Walrus storage; it pulls in `@mysten/sui` for on-chain account ops and `@mysten/seal` for client-side encryption transitively, but pin them so the merge step keeps current syntax.

```bash
pnpm add @mysten-incubation/memwal@0.0.7 @mysten/sui@2.19.0 @mysten/seal@1.2.0
```

## Step 2: Bootstrap a MemWal account + delegate key (one-time, on Sui testnet)

A backend signs Walrus Memory writes with a **delegate key** under a single **account**, so user requests never touch the owner key. `@mysten/sui` 2.x removed the old `SuiClient` export — construct a `SuiJsonRpcClient` and pass it explicitly to `createAccount`/`addDelegateKey`.

```ts
import { getFullnodeUrl } from "@mysten/sui/client";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { generateDelegateKey, createAccount, addDelegateKey } from "@mysten-incubation/memwal/account";

const PKG = "0x6c2547cbf5e8d4e1a3f2b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8";
const REG = "0x1f0e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff0";
const ownerKey = process.env.OWNER_SUI_KEY!; // suiprivkey1qz...3w8 (redacted — never commit)

const suiClient = new SuiJsonRpcClient({ url: getFullnodeUrl("testnet") });

const delegate = await generateDelegateKey();
const account = await createAccount({
  packageId: PKG, registryId: REG, suiPrivateKey: ownerKey,
  suiNetwork: "testnet", suiClient,
});
await addDelegateKey({
  packageId: PKG, accountId: account.accountId, publicKey: delegate.publicKey,
  label: "waldocs-backend", suiPrivateKey: ownerKey, suiNetwork: "testnet", suiClient,
});

console.log("MEMWAL_ACCOUNT_ID=", account.accountId);   // 0x9a8b...4f3a
console.log("MEMWAL_PRIVATE_KEY=", delegate.privateKey); // suiprivkey1qa...9k2 (redacted — store as a secret)
```

Persist `account.accountId` and the delegate `privateKey` as `MEMWAL_ACCOUNT_ID` / `MEMWAL_PRIVATE_KEY` secrets.

## Step 3: Create a rate-limited MemWal client

The staging relayer caps roughly 30 weighted requests/minute per delegate key. Wrap `remember`/`recall` with a minimum gap so a multi-write publish doesn't trip 429s.

```ts
import { MemWal } from "@mysten-incubation/memwal";

const raw = MemWal.create({
  key: process.env.MEMWAL_PRIVATE_KEY!,        // suiprivkey1qa...9k2 (redacted)
  accountId: process.env.MEMWAL_ACCOUNT_ID!,   // 0x9a8b...4f3a
  serverUrl: "https://relayer-staging.memory.walrus.xyz",
});

const MIN_GAP_MS = 2_200; // ~27 req/min, under the relayer cap
let lastAt = 0;
async function rateLimited(fn) {
  const wait = lastAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  return fn();
}

const memwal = {
  remember: (text, namespace) => rateLimited(() => raw.remember(text, namespace)),
  recall: (params) => rateLimited(() => raw.recall(params)),
  waitForRememberJob: (jobId, opts) => raw.waitForRememberJob(jobId, opts),
};
```

## Step 4: Write memories non-blocking (remember -> jobId)

`rememberAndWait` embeds + Seal-encrypts + uploads synchronously (~10s/write) and would blow a serverless function limit. Use plain `remember()`: it enqueues and returns a `job_id` immediately, and the relayer certifies on Walrus in the background. Store the content in your own DB right away so pages render before certification.

```ts
// Namespace scheme: protocols -> `proto.<slug>`, apps -> `<author>/<repo>/<commit>`.
const namespace = "Chomtana/waldocs/3c2807f";
const step = "## Step 1: Install the SDKs\n\n```bash\npnpm add @mysten-incubation/memwal@0.0.7\n```";

const { job_id } = await memwal.remember(step, namespace);
console.log("queued:", job_id); // e.g. job_7f3c1a90 — reconcile to a blobId later
```

## Step 5: Reconcile queued jobs to Walrus blob ids (background)

Resolve each pending `job_id` to its certified `blobId` out-of-band (a cron or external ping), then fill the nullable `walrusBlobId` column. Keep the resolve poll off the rate-limited path since it runs in the background.

```ts
async function resolveJob(jobId) {
  try {
    const r = await memwal.waitForRememberJob(jobId, { timeoutMs: 12_000, pollIntervalMs: 1_500 });
    return { blobId: r.blobId }; // 0x4d2e...a1b7
  } catch {
    return null; // not certified yet — retry on the next reconcile tick
  }
}

const resolved = await resolveJob("job_7f3c1a90");
if (resolved) console.log("certified blob:", resolved.blobId);
```

## Step 6: Encrypt sensitive payloads with Seal before storing

Walrus Memory uses Seal threshold encryption under the hood so blobs are sealed client-side before they reach the relayer. When you store secrets directly, encrypt with a Seal policy keyed to your access-control package.

```ts
import { SealClient } from "@mysten/seal";

const seal = new SealClient({ suiClient, serverObjectIds: ["0x7c1a...e93f"] });
const { encryptedObject } = await seal.encrypt({
  threshold: 2,
  packageId: "0x6c25...d9e8",
  id: "waldocs/secret/1",
  data: new TextEncoder().encode("super-secret-value"),
});
console.log("sealed bytes:", encryptedObject.length);
```

## Step 7: Semantically search memories with recall

`recall` runs a semantic query inside one namespace — the basis of RAG over a single protocol or app. Tune `limit` and `maxDistance` to trade recall for precision.

```ts
const hits = await memwal.recall({
  query: "how do I bootstrap a delegate key",
  namespace: "proto.walrus",
  limit: 3,
  maxDistance: 0.6,
});

for (const h of hits) console.log(h.text.slice(0, 80));
```
