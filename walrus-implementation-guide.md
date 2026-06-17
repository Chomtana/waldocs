# Walrus — Implementation Guide for a Sui Overflow 2026 Project

> A developer-focused reference on the Walrus decentralized storage protocol (Mysten Labs, on Sui), written for someone planning a project in the **Sui Overflow 2026 — Walrus track**. Architecture is summarized; the bulk is implementation: CLI, HTTP API, TypeScript SDK, Quilt, Walrus Sites, Move integration, and Walrus + Seal patterns.

> 🧪 **Hackathon convention: this guide targets TESTNET everywhere.** All code samples use Sui **testnet**, the Walrus **testnet** binary/config, and the Walrus Memory **staging** relayer (`relayer-staging.memory.walrus.xyz`) + **testnet** contract IDs. Switch to mainnet/prod only at the end when you ship. Factual mentions of mainnet (epoch lengths, the `wal.app` portal, etc.) are left as-is for reference.

**Last researched:** 2026-06-17. Walrus is a live, fast-moving protocol — network parameters (epoch length, max blob size, prices, `max_epochs_ahead`) drift. Always confirm against your installed binary (`walrus info`, `--help`) before depending on a specific number. Several `docs.wal.app` pages return HTTP 403 to automated fetchers, so some facts below were corroborated via the `MystenLabs/walrus` and `MystenLabs/ts-sdks` GitHub source and indexed snippets; version-dependent items are flagged inline.

---

## 0. The 30-second model

Walrus stores arbitrary bytes as **immutable, content-addressed blobs**. Each blob is erasure-coded (RedStuff, ~4.5–5× expansion) into *slivers* spread across a Byzantine committee of storage nodes. **Sui is the control plane**: it holds the `Blob` object, the storage payment (in **WAL**), the lifetime (`end_epoch`), and emits the `BlobCertified` event that proves availability.

Two IDs you must never conflate:
- **`blob_id`** (`u256`) — the **content hash**. Same bytes ⇒ same `blob_id`. This is what readers fetch by. Shown as URL-safe Base64.
- **Sui object ID** (`UID`) — the **ownership handle**. Two people storing identical bytes share a `blob_id` but get **different object IDs**.

What Walrus is **not**: not a database (no in-place mutation — "editing" = re-upload as a new blob), not compute, not encrypted at rest (**all blobs are public by default** — encrypt client-side if sensitive), and not permanent-by-magic (data expires at `end_epoch` unless extended).

---

## 1. Sui Overflow 2026 — the Walrus track

| Fact | Detail |
|---|---|
| Event | **Sui Overflow 2026**, Sui's global hackathon — pre-register at [overflow.sui.io](https://overflow.sui.io/) |
| Walrus's role | **Headline Partner** (in 2025 it was the "Programmable Storage" track; in 2026 Walrus is the marquee sponsor) |
| Track prizes | **1st $30,000 · 2nd $15,000 · 3rd $10,000 · 4th $7,500** |
| Total pool | $500K+ across core and sponsored tracks |
| Track framing | "Build apps that deeply integrate the programmable storage capabilities of Sui and Walrus" — off-chain + verifiable data |

**What judges rewarded in 2025** (directional, not an official 2026 rubric — themes seen across coverage were *innovation, impact, technical complexity, UX*). The 2025 Programmable Storage winners are a strong signal of what reads as a complete Walrus project:

1. **SuiSign (1st)** — decentralized document signing: upload docs, define signers, collect verifiable on-chain signatures.
2. **WalGraph (2nd)** — decentralized graph database (on-chain index + JSON-LD + CRUD).
3. **SuiMail (3rd)** — wallet-native decentralized email with pay-to-send anti-spam.
4. **Walpress (4th)** — censorship-resistant website builder with SuiNS + a creator marketplace.

Other tracks leaned on Walrus too: **OpenGraph** (ML weights on Walrus), **ZeroLeaks** (ZK whistleblowing via Seal + Walrus), **SuiFL** (federated-learning weights). Takeaway: the strongest entries pair **Walrus storage** with a **real on-chain Move policy** and often **Seal** for privacy — not "uploaded a file to Walrus" alone.

---

## 2. Install & configure the CLI

**Install (suiup, recommended):**
```sh
suiup install sui
suiup install walrus
```

**Install (direct binary):**
```sh
SYSTEM=macos-arm64   # or ubuntu-x86_64, macos-x86_64, windows-x86_64.exe
curl https://storage.googleapis.com/mysten-walrus-binaries/walrus-testnet-latest-$SYSTEM -o walrus
chmod +x walrus && sudo mv walrus /usr/local/bin/
# use walrus-mainnet-latest-$SYSTEM for the mainnet channel
```

**Config:**
```sh
curl --create-dirs https://docs.wal.app/setup/client_config.yaml \
  -o ~/.config/walrus/client_config.yaml
```
Search order: cwd → `$XDG_CONFIG_HOME/walrus/` → `~/.config/walrus/` → `~/.walrus/`. The config uses a `contexts:` map (`mainnet` + `testnet`) with `default_context: testnet`; select per-call with `--context mainnet`. Key params today: `n_shards: 1000`, `max_epochs_ahead: 53`.

**Get tokens (testnet):**
```sh
# 1. testnet SUI from https://faucet.sui.io/  (or `sui client faucet`)
# 2. swap SUI -> WAL (testnet only):
walrus get-wal              # default 0.5 SUI -> 0.5 WAL
walrus get-wal --amount 500000000   # in FROST (1 WAL = 1e9 FROST)
```
> `get-wal` is **testnet-only**. On mainnet, acquire WAL via an exchange/wallet. You always need **both SUI** (gas for register + certify txs) **and WAL** (storage + write fee).

**Sanity check:** `walrus info` prints the current epoch, shard count, max blob size, and live prices — treat it as the authoritative source for network params.

---

## 3. CLI commands (the ones you'll actually use)

```sh
# Store (—epochs is REQUIRED). Permanent by default; pass --deletable to allow deletion.
walrus store ./video.mp4 --epochs 100
walrus store *.png --epochs max
walrus store ./tmp.bin --epochs 5 --deletable

# Read
walrus read <BLOB_ID> --out ./out.bin        # default: stdout

# Status / introspection
walrus blob-status --blob-id <BLOB_ID>        # availability + expiry
walrus blob-id ./file                          # compute content commitment without storing
walrus list-blobs                              # owned, non-expired Blob objects
walrus info                                     # epoch, shards, max size, live prices

# Lifecycle
walrus extend --blob-obj-id <SHARED_OBJ_ID> --epochs <N>   # extend a shared permanent blob
walrus delete --object-id <OBJ_ID> --yes                   # only works on --deletable blobs
```

Useful flags on `store`: `--force` (fresh object even if content already stored), `--share` (wrap as a shared blob others can reference/fund), `--amount <FROST>` (fund a shared blob). `--epochs max` is capped by `max_epochs_ahead` (**currently 53**, not the stale "183/200" in old docs).

**JSON output** (for scripting):
```sh
walrus store ./file --epochs 10 --json      # machine-readable result
# or the `walrus json` subcommand — pass a full command spec on stdin/argv:
echo '{"command":{"read":{"blobId":"4BKcDC0Ih5RJ8R0t..."}}}' | walrus json
```

> Flags to verify on *your* binary with `--help`: `--permanent` (documents the default), exact `extend` flags, and the `--json` output shape. CLI surface shifts between releases.

---

## 4. HTTP API — Publisher & Aggregator

The same binary runs the daemons. This is the easiest integration path for a web app that doesn't want WASM in the browser.

```sh
walrus aggregator --bind-address "127.0.0.1:31415"                       # reads, no tokens
walrus publisher  --bind-address "127.0.0.1:31416" --sub-wallets-dir "$D" --n-clients 1   # writes, spends SUI+WAL
walrus daemon     --bind-address "127.0.0.1:31415"                       # both
```

### Write — `PUT /v1/blobs`
Query params: `epochs` (default 1), `deletable=true` (else permanent), `send_object_to=<ADDRESS>`.
```sh
curl -X PUT "$PUBLISHER/v1/blobs?epochs=5" --upload-file ./file.png
curl -X PUT "$PUBLISHER/v1/blobs?deletable=true&send_object_to=$ADDR" --upload-file ./file
```

`newlyCreated` response (first time this content is stored — you pay):
```json
{ "newlyCreated": {
    "blobObject": {
      "id": "0xd765d118...",
      "blobId": "Cmh2LQEGJwBYfmIC8duzK8FUE2UipCCrshAYjiUheZM",
      "size": 17, "encodingType": "RedStuff", "certifiedEpoch": 0,
      "storage": { "startEpoch": 0, "endEpoch": 1, "storageSize": 4747680 },
      "deletable": false },
    "cost": 231850 } }
```
`alreadyCertified` response (identical content already on the network — you **don't** pay again):
```json
{ "alreadyCertified": {
    "blobId": "Cmh2LQEGJwBYfmIC8duzK8FUE2UipCCrshAYjiUheZM",
    "event": { "txDigest": "CLE41JTPR2...", "eventSeq": "0" },
    "endEpoch": 1 } }
```
Notes: `blobId` = content ID (fetch by this); `blobObject.id` = Sui object ID; `storageSize` is the **encoded** size (≫ raw `size`); `cost` is in **FROST**.

### Read — Aggregator (GET)
```sh
curl "$AGGREGATOR/v1/blobs/<BLOB_ID>"                       -o out.bin
curl "$AGGREGATOR/v1/blobs/by-object-id/<OBJECT_ID>"        -o out.bin
curl "$AGGREGATOR/v1/blobs/by-quilt-patch-id/<PATCH_ID>"    -o one-file.bin
```
`GET /v1/api` serves the OpenAPI spec on both daemons.

> **Production caveat:** the *public* publishers cap bodies at **10 MiB** and spend the operator's tokens; public aggregators are shared/rate-limited. For anything real, **self-host `walrus daemon`** behind Nginx + a CDN, or use the SDK + an upload relay.

---

## 5. TypeScript SDK — `@mysten/walrus`

```sh
npm install @mysten/walrus @mysten/sui
# @mysten/walrus-wasm (erasure coding / BLS) comes along as a dependency
```

The Walrus client always rides on a Sui client (it submits the `register` + `certify` txs and pays gas) and additionally talks to storage nodes over HTTP directly. The SDK bundles testnet/mainnet object IDs, so `network: 'testnet'` is enough.

```ts
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { walrus } from '@mysten/walrus';
import { Agent, setGlobalDispatcher } from 'undici';

// storage nodes are slow — raise timeouts
setGlobalDispatcher(new Agent({ connectTimeout: 60_000, connect: { timeout: 60_000 } }));

const client = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
}).$extend(walrus({ storageNodeClientOptions: { timeout: 60_000 } }));

const keypair = Ed25519Keypair.fromSecretKey('suiprivkey1q...'); // must hold SUI + WAL

// write
const data = new TextEncoder().encode('Hello from Walrus!\n');
const { blobId, blobObject } = await client.walrus.writeBlob({
  blob: data, deletable: false, epochs: 3, signer: keypair,
});

// read
const bytes = await client.walrus.readBlob({ blobId });
console.log(new TextDecoder().decode(bytes));
```

**Core methods:** `writeBlob({ blob, deletable, epochs, signer })` → `{ blobId, blobObject }` · `readBlob({ blobId })` → `Uint8Array` · `getBlobMetadata({ blobId })` · `writeFiles({ files, epochs, deletable, signer })` (multi-file → quilt) · `executeDeleteBlobTransaction(...)` · `executeExtendBlobTransaction(...)`.

**Browser / wallet flows:** `writeBlobFlow` / `writeFilesFlow` split the register and certify steps across separate user clicks (crash-recoverable). Pair with `@mysten/dapp-kit` for wallet connection — note there is **no separate "Walrus dApp kit"**; you use the general Sui dApp Kit alongside `@mysten/walrus`.

**Gotchas worth knowing up front:**
- A direct browser write fans out to ~2,200 node requests — use an **upload relay** (`walrus({ uploadRelay: { host, sendTip } })`) to offload it.
- On epoch transitions you may hit `RetryableWalrusClientError` — call `client.walrus.reset()` and retry.
- Bundlers: Vite — import the wasm URL and pass `walrus({ wasmUrl })`; Next.js — add `serverExternalPackages: ['@mysten/walrus','@mysten/walrus-wasm']`.
- **Version-dependent:** current examples use `SuiGrpcClient(...).$extend(walrus())`; older code uses `new SuiClient({ url })` (JSON-RPC) passed as `suiClient` to `new WalrusClient(...)`. Pin both `@mysten/walrus` and `@mysten/sui` versions.

---

## 6. Quilt — batching many small blobs

**Problem it solves:** storing many small files individually is expensive (per-blob encoding overhead + per-blob on-chain registration gas). **Quilt** packs **up to ~660 files** into one storage unit while keeping each individually addressable. Vendor figures: ~106× cheaper for 100 KB blobs, ~420× for 10 KB. (Introduced ~v1.29, July 2025.)

Concepts: the quilt has a **quilt-id** (its own Blob ID); each inner file has a **`QuiltPatchId`**; **identifiers** are unique names within a quilt; **tags** are arbitrary key/value metadata.

```sh
walrus store-quilt --epochs 100 --paths ./images ./meta.json
walrus store-quilt --epochs 100 \
  --blobs '{"path":"a.png","identifier":"hero","tags":{"kind":"img"}}' \
          '{"path":"b.png","identifier":"icon","tags":{"kind":"img"}}'

walrus read-quilt --out ./dl --quilt-id <QID> --identifiers hero icon
walrus read-quilt --out ./dl --quilt-id <QID> --tag kind img
walrus list-patches-in-quilt <QID>
```

**SDK** uses the `WalrusFile` API (no `writeQuilt`/`readQuilt`):
```ts
import { WalrusFile } from '@mysten/walrus';
const files = [WalrusFile.from({ contents: bytes, identifier: 'test1', tags: { a: 'a' } })];
const quilt = await client.walrus.writeFiles({ files, deletable: true, epochs: 3, signer: keypair });
const [f] = await client.walrus.getFiles({ ids: [quiltPatchId] });
await f.getTags(); new TextDecoder().decode(await f.bytes());
```
Caveat: every file in one `writeFiles` call lands in a **single** quilt, and you can't delete/extend/share an individual file within a quilt. Use `writeBlob` for a lone large blob (quilt encoding is inefficient for one file).

---

## 7. Walrus Sites — fully on-chain static websites

Assets are blobs (now bundled into a quilt); a Sui **Site object** maps `resource path → blob_id + headers`; a **portal** resolves a subdomain → Site object → fetches blobs → serves them. No server, ownership on-chain.

```sh
# site-builder (Rust CLI; needs SUI + WAL + sites-config.yaml)
site-builder deploy ./dist --epochs 100      # publishes, or updates if ws-resources.json has object_id
site-builder convert <OBJECT_ID>             # hex object id -> Base36 subdomain
site-builder sitemap --id <OBJECT_ID>
```
First `deploy` writes the new Site `object_id` back into `ws-resources.json` so later deploys update the same site. There's also an official **GitHub Action** (`MystenLabs/walrus-sites-github-actions`).

**SuiNS:** own a name → SuiNS UI → "Names you own" → **"Link To Walrus Site"** → point at the Site object, giving `https://yourname.wal.app`. `https://wal.app` is the public **mainnet** portal. **Testnet has no public portal — self-host one.** Without a SuiNS name, sites are reachable via the Base36 form of the object ID.

Reference: `MystenLabs/example-walrus-sites` and **Flatland** (auto-generates a per-NFT site).

---

## 8. Move integration — referencing a blob on-chain

The `Blob` Move struct (`walrus::blob`):
```move
public struct Blob has key, store {
    id: UID,
    registered_epoch: u32,
    blob_id: u256,                       // content commitment
    size: u64,
    encoding_type: u8,
    certified_epoch: option::Option<u32>, // None until certified
    storage: Storage,                     // { id, start_epoch, end_epoch, storage_size }
    deletable: bool,
}
```
Accessors: `blob::blob_id(&b): u256`, `blob::object_id(&b): ID`, `size()`, `encoding_type()`, `certified_epoch()`.

**On-chain attestation pattern.** A contract attests to off-chain data by holding or referencing a **certified** `Blob`. Move logic can check the data is committed and currently available:
```move
// pseudo: require the blob is certified and not yet expired
assert!(option::is_some(&blob.certified_epoch), E_NOT_CERTIFIED);
assert!(blob.storage.end_epoch >= current_epoch, E_EXPIRED);
let id: u256 = blob::blob_id(&blob);   // store this in your app object
```
Use an **owned** Blob for private control, or a **shared** Blob when multiple users/contracts must reference the same payload. There's also a metadata/attributes system (`add_metadata`, `insert_or_update_metadata_pair`, …) to attach arbitrary on-chain key/values to a Blob without touching its content.

Typical app flow: store on Walrus → receive certified `Blob` on Sui → embed its `ID`/`blob_id` in your app object (post, NFT, dataset license, …), or wrap/share the Blob.

---

## 9. Private data — Walrus + Seal

Walrus blobs are **public**. For access-controlled data, use **Seal** (Mysten's decentralized secrets-management / threshold-encryption product) — this is the combo most winning privacy projects used.

How Seal works: **Identity-Based Encryption** (BLS12-381) + AES-256-GCM, with a **t-of-n threshold** of key servers. Access is governed by **`seal_approve*` Move functions** you write — key servers evaluate them read-only (`dry_run`) against on-chain state; if the function aborts, no key share is released. A **SessionKey** (signed once per package) avoids repeated wallet prompts.

**Canonical Walrus + Seal pattern:**
1. **Encrypt client-side:** `seal.encrypt({ threshold, packageId, id, data })`.
2. **Store ciphertext on Walrus** → get `blob_id`.
3. **Record `blob_id` + access policy in a Sui Move object** (allowlist / subscription / ViewerToken).
4. **Reader proves entitlement:** builds a PTB calling `seal_approve*`, signs with a SessionKey; key servers `dry_run` and return shares if approved.
5. **Reader combines `t` shares**, derives the key, decrypts.

For large files, use **envelope encryption**: AES-encrypt the blob, Seal-encrypt only the AES key, store the ciphertext on Walrus and keep the Seal-wrapped key on Sui — lets you rotate policy/key servers without re-uploading.

Fork-ready Move patterns in `MystenLabs/seal` (`move/patterns/sources/`): `whitelist.move`, `subscription.move`, `tle.move` (time-lock), `voting.move`, `private_data.move`, `account_based.move`. Reference app: **OnlyFins** (creator platform — media on Walrus, Seal-encrypted, a `ViewerToken` Sui object gates decryption).

---

## 10. Costs & limits (verify with `walrus info`)

| Thing | Value | Notes |
|---|---|---|
| Max blob size | **~13.3 GiB** | network param; split larger data into multiple blobs |
| Token | **WAL** | `1 WAL = 1e9 FROST` (like Sui's MIST); `--amount` flags are FROST |
| You pay for | **encoded** size, **per epoch** | ~5× expansion + metadata; plus a one-time write fee |
| Pricing | dynamic (node voting, USD-pegged) | no fixed FROST/MiB figure — read `walrus info` or `costcalculator.wal.app` |
| Epoch length | **testnet 1 day · mainnet 14 days** | `--epochs N` multiplies by this |
| Max lifetime | `max_epochs_ahead` (**currently 53**) | ~2 years on mainnet; extend to keep data alive |

Content-addressing means **duplicate uploads are free** (you get `alreadyCertified` and only pay gas). Deleting a `--deletable` blob reclaims its storage resource, but identical content others uploaded persists, and the content hash stays recorded on Sui.

---

## 11. Project ideas mapped to proven patterns

Each pairs Walrus's unique value (cheap large-blob storage + on-chain ownership/availability ± Seal privacy) with a real precedent:

1. **Token-gated creator vault** — media → Seal-encrypt → Walrus; `subscription.move`/ViewerToken holds policy + `blob_id`. *(OnlyFins)*
2. **Decentralized e-signature / notarization** — doc → Walrus; Move object records `blob_id`, signer set, signatures + timestamps. *(SuiSign — 2025 1st)*
3. **Encrypted personal/team cloud** — `@mysten/walrus` + Seal allowlist (`whitelist.move`); time-locked share links (`tle.move`). *(Tusky)*
4. **AI dataset / model-weight marketplace** — dataset → Walrus (`blob_id` on-chain for provenance); license object + Seal-gated decrypt key. *(OpenGraph, SuiFL)*
5. **Decentralized short-video / photo feed** — video + thumbnail blobs; profile/post = Sui objects; feed indexes `blob_id`s. *(Vibe)*
6. **No-code Walrus Sites builder + SuiNS** — site-builder + template marketplace; mint Site object; "Link To Walrus Site". *(Walpress — 2025 4th)*
7. **Whistleblower / leak platform** — Seal threshold-encrypt → Walrus; on-chain allowlist/time-lock controls reveal; ZK for submitter anonymity. *(ZeroLeaks)*
8. **Decentralized code / release hosting** — repo snapshots → Walrus blobs; Move object maps repo → versioned `blob_id`s for provenance.
9. **On-chain game with Walrus assets** — sprites/levels as blobs; dynamic NFTs + game state on Sui; client loads by `blob_id`. *(Walrus-snake)*
10. **NFT platform with truly on-chain media** — media → Walrus `Blob`; NFT references `blob_id`; optional Seal-gated unlockable content. *(Flatland, TradePort)*

**Judge-bait checklist:** (a) the data genuinely *needs* Walrus (large/media/verifiable, not a 1 KB JSON that belongs on Sui); (b) a real Move policy object on-chain; (c) Seal if anything is private; (d) a polished demo that reads the blob back and shows ownership/availability working; (e) SuiNS / Walrus Sites for a slick censorship-resistant front end.

---

## 12. Starter stack & first-day checklist

```sh
# 1. tooling
suiup install sui && suiup install walrus
curl --create-dirs https://docs.wal.app/setup/client_config.yaml -o ~/.config/walrus/client_config.yaml

# 2. funds (testnet)
sui client faucet          # SUI
walrus get-wal             # WAL

# 3. smoke test
echo "hello walrus" > hello.txt
walrus store hello.txt --epochs 5 --deletable --json    # grab the blobId
walrus read <BLOB_ID>                                    # -> "hello walrus"

# 4. app scaffold
npm create @mysten/dapp        # React + dapp-kit
npm install @mysten/walrus @mysten/seal
```

Then layer in: a Move package with your policy object + (if private) `seal_approve*`, the TS SDK write/read flow, and a Walrus Sites front end with a SuiNS name.

---

## 13. Walrus Memory / MemWal — a different implementation

**Walrus Memory** (package/shorthand **`memwal`**) is a *separate product* built **on top of** the base protocol — a **portable memory layer for AI agents**. It launched in **beta ~March 2026** and has a meaningfully different implementation from raw blob storage and Walrus Sites. Don't confuse it with §3–8: those are the raw storage substrate; Walrus Memory is a managed service layered over it.

> Status: **beta**, scope `@mysten-incubation/memwal` (not core `@mysten`). API surface below is verbatim from the [`MystenLabs/MemWal`](https://github.com/MystenLabs/MemWal) repo (README, `SKILL.md`, `docs/sdk/api-reference.md`) as of 2026-06-17, but expect churn.

### 13.1 How the implementation differs

It's a **hybrid, relayer-mediated** architecture — not a self-serve client like §5:

| Concern | Where it lives |
|---|---|
| Encrypted memory blobs | **Walrus** (decentralized storage) |
| Encryption | **Seal** (threshold IBE — confirmed: `@mysten/seal` is a peer dep, "local SEAL operations") |
| **Vector index** (embeddings) | **PostgreSQL + `pgvector` inside the relayer** (centralized); embeddings via an OpenAI-compatible API — default `text-embedding-3-small`, **1536 dims**. The big departure from raw Walrus, which has no search |
| Ownership / access control | **Sui** — a `MemWalAccount` object + Ed25519 **delegate keys** |
| Embedding, encrypt, upload, search | The **relayer** orchestrates it all |

The relayer's four operations (from the repo's "How It Works"):
1. **Scope** — every op runs inside an `owner + namespace` boundary.
2. **Store** — relayer **embeds → Seal-encrypts → uploads to Walrus → stores vector metadata in PostgreSQL**.
3. **Recall** — searches by `owner + namespace`, resolves matching blobs, returns **decrypted plaintext**.
4. **Restore** — incrementally rebuilds missing index entries for a namespace from Walrus.

**vs. base Walrus (§3–5):** you fetch a blob only by its exact `blob_id`, it's public by default, and you run the storage flow yourself. **Walrus Memory** adds semantic (vector) retrieval, encryption-by-default, an async job model, and a delegate-key auth model — at the cost of depending on a managed relayer + Postgres.

**Two trust modes (important for a privacy-sensitive hackathon project):**
- **Default `MemWal`** — relayer does the Seal encrypt/decrypt, so **the relayer sees plaintext**. Easiest.
- **`MemWalManual`** — client does embedding + Seal **locally**; the relayer only ever sees ciphertext + vector. Use when you can't trust the relayer with plaintext.

### 13.2 Setup — account & delegate keys (the important part)

**The mental model — owner vs. delegate (two different keys, two different jobs):**

| | **Owner key** | **Delegate key** |
|---|---|---|
| What it is | A funded **Sui wallet** (bech32 `suiprivkey1...` or a dapp-kit wallet) | A bare **Ed25519 keypair** generated locally |
| Owns | The `MemWalAccount` object (**one per Sui address**, contract-enforced) | Nothing — it's *authorized by* the account |
| Signs | On-chain txs: `createAccount`, `add/removeDelegateKey` (costs SUI gas) | Relayer requests: `remember` / `recall` / … (no gas, no chain tx) |
| Where it lives | Your wallet — used rarely, for admin | In `MemWal.create({ key })` — used constantly by the app |
| If leaked | Full account control | Scoped read/write to memory; **revoke it** with `removeDelegateKey`, owner key stays safe |

This separation is the whole point: your app/agent holds only a **delegate key**, so it can read and write memory **without ever touching the owner's wallet key**, and you can revoke a delegate without rotating the owner. Each account can hold **multiple** delegate keys (one per device/agent/env), each with a human label.

```bash
pnpm add @mysten-incubation/memwal
# Account ops + client-side Seal also need the Sui peer deps:
pnpm add @mysten/sui @mysten/seal @mysten/walrus
```

You can do the whole bootstrap in the dashboard ([memory.walrus.xyz](https://memory.walrus.xyz)) — or in code. **The code path, step by step:**

```ts
import {
  generateDelegateKey, createAccount, addDelegateKey, removeDelegateKey,
} from "@mysten-incubation/memwal/account";
// Testnet (staging) contract IDs — see §13.15. Use these for the hackathon.
const MEMWAL_PACKAGE_ID  = "0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6";
const MEMWAL_REGISTRY_ID = "0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437";

// 1) Generate a delegate keypair — FULLY LOCAL, no chain call, no gas.
//    Internally: 32 random bytes -> Ed25519 pubkey -> Sui address (blake2b of 0x00 flag + pubkey).
const delegate = await generateDelegateKey();
// -> { privateKey: "<hex>",        // RAW HEX (not bech32). Store securely; goes into MemWal.create({ key })
//      publicKey:  Uint8Array(32), // registered on-chain in step 3
//      suiAddress: "0x..." }       // address derived from the delegate pubkey

// 2) Create the on-chain account (owner signs — needs a funded Sui wallet + gas).
//    Calls {packageId}::account::create_account(registry, clock). ONE account per owner address.
const account = await createAccount({
  packageId: MEMWAL_PACKAGE_ID,
  registryId: MEMWAL_REGISTRY_ID,            // the AccountRegistry shared object (= MEMWAL_REGISTRY_ID)
  suiPrivateKey: process.env.OWNER_SUI_KEY!, // bech32 "suiprivkey1..."  — OR walletSigner (dapp-kit), not both
  suiNetwork: "testnet",                     // hackathon: testnet everywhere (SDK default is "mainnet")
  // suiClient,                              // pass your own SuiClient for @mysten/sui v2.6.0+
});
// -> { accountId: "0x...", owner: "0x...", digest: "..." }

// 3) Authorize the delegate key on that account (owner-only tx).
//    Calls {packageId}::account::add_delegate_key(account, public_key, sui_address, label, clock).
await addDelegateKey({
  packageId: MEMWAL_PACKAGE_ID,
  accountId: account.accountId,
  publicKey: delegate.publicKey,             // Uint8Array(32) OR hex string; must be exactly 32 bytes
  label: "hackathon-dev-1",                  // human-readable; for your own auditing
  suiPrivateKey: process.env.OWNER_SUI_KEY!, // the OWNER signs again
  suiNetwork: "testnet",
});
// -> { digest, publicKey: "<hex>", suiAddress: "0x..." }

// 4) Use the DELEGATE private key with the client (this is all the app needs from here on).
import { MemWal } from "@mysten-incubation/memwal";
const memwal = MemWal.create({
  key: delegate.privateKey,                  // Ed25519 delegate private key (hex) — SERVER-SIDE ONLY
  accountId: account.accountId,              // the MemWalAccount object ID
  serverUrl: "https://relayer-staging.memory.walrus.xyz",   // testnet/staging relayer (prod: relayer.memory.walrus.xyz)
  namespace: "my-app",
});

// Revoke a delegate later (owner-only) — does NOT touch the owner key or other delegates:
await removeDelegateKey({
  packageId: MEMWAL_PACKAGE_ID,
  accountId: account.accountId,
  publicKey: delegate.publicKey,
  suiPrivateKey: process.env.OWNER_SUI_KEY!,
});
```

**Browser variant** — swap `suiPrivateKey` for a dapp-kit `walletSigner` (the account/admin txs then prompt the user's wallet):

```ts
import { useSignAndExecuteTransaction, useCurrentAccount } from "@mysten/dapp-kit";
const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();
const current = useCurrentAccount();

await createAccount({
  packageId: MEMWAL_PACKAGE_ID,
  registryId: MEMWAL_REGISTRY_ID,
  suiNetwork: "testnet",                      // explicit — the SDK default is "mainnet"
  walletSigner: { address: current!.address, signAndExecuteTransaction, signPersonalMessage },
});
// `walletSigner` must provide: address, signAndExecuteTransaction, signPersonalMessage
// (signPersonalMessage is also what Seal uses to mint a SessionKey).
```

**Key-handling rules (don't skip):**
- The **delegate `privateKey` is RAW HEX**, while the **owner `suiPrivateKey` is bech32 `suiprivkey1...`** — they are not interchangeable. Easy mistake.
- Keep the delegate key **server-side only** (Next.js server actions / route handlers reading `MEMWAL_PRIVATE_KEY`); never ship it to the browser.
- `createAccount` / `add` / `remove` provide **EITHER** `suiPrivateKey` **OR** `walletSigner`, never both. The owner address must hold **SUI for gas**.
- One `MemWalAccount` per owner address (contract-enforced) — to "reset," create from a different address or reuse the existing account and rotate delegates.
- Relayers: **prod** = `relayer.memory.walrus.xyz` (mainnet) · **staging** = `relayer-staging.memory.walrus.xyz` (testnet). Never mix staging credentials with the mainnet relayer.

### 13.3 Scenario: store a memory (3 ways)

```ts
// (a) fire-and-forget async job
const accepted = await memwal.remember("User prefers dark mode and uses TypeScript.");
// -> { job_id, status: "running" }   (embedding/encryption/upload happen in background)

// (b) store and block until indexed (use in save-then-immediately-recall UIs)
const stored = await memwal.rememberAndWait(
  "User lives in Hanoi.", "my-app", { timeoutMs: 30_000 },
);
// -> { id, job_id, blob_id, owner, namespace }

// (c) poll a previously accepted job manually
const done = await memwal.waitForRememberJob(accepted.job_id, {
  pollIntervalMs: 750, timeoutMs: 30_000,
});
```

### 13.4 Scenario: bulk store (up to 20 at once)

```ts
const bulk = await memwal.rememberBulk([
  "User is allergic to peanuts.",
  "User's timezone is GMT+7.",
  "User ships to Bangkok.",
]); // -> { job_ids, total, status }

const settled = await memwal.rememberBulkAndWait([
  "Fact A", "Fact B",
], { timeoutMs: 60_000 });
// -> { results: [{ id, blob_id, status, namespace }], total, succeeded, failed }
```

### 13.5 Scenario: recall by meaning (+ relevance filtering)

```ts
const res = await memwal.recall({
  query: "What are the user's preferences?",
  limit: 10,                 // top-K (alias: topK)
  namespace: "my-app",
  maxDistance: 0.7,          // drop weak matches client-side (lower distance = more similar)
});
// -> { results: [{ blob_id, text, distance }], total }
```
Distance guide (cosine): `<0.25` near-duplicate · `0.25–0.55` related · `0.55–0.7` weak · `≥0.7` usually unrelated. **There is no default threshold** — small namespaces return filler unless you filter.

### 13.6 Scenario: extract facts from free-form text (`analyze`)

Instead of storing a raw sentence, let an LLM distill memorable facts, each stored separately:

```ts
const out = await memwal.analyzeAndWait(
  "I live in Hanoi, I prefer dark mode, and I'm allergic to peanuts.",
  "my-app", { timeoutMs: 30_000 },
);
out.facts.forEach(f => console.log(f.text));
// -> three separate indexed memories
// non-blocking variant: memwal.analyze(text, namespace) -> { job_ids, facts, fact_count, ... }
```

### 13.7 Scenario: namespaces (isolation + the append gotcha)

```ts
// Namespaces are opaque flat strings scoped to one owner. Recall in "A" never sees "B".
await memwal.remember("Internal note", "team-secret");
await memwal.remember("Public bio",   "public");

// remember() is ALWAYS append, never upsert — same text twice = two entries:
await memwal.remember("I prefer dark mode", "prefs");
await memwal.remember("I prefer dark mode", "prefs"); // now 2 identical entries
```
No hierarchy: `"chat/user-42"` is one literal label, not a path (exact-equality `WHERE namespace = $1`). Omitting namespace falls back to the literal `"default"`. Build hierarchy in your app layer (recall across known namespaces, merge client-side).

| Scope | Recall sees it? |
|---|---|
| same owner + same namespace | ✅ |
| same owner, different namespace | ❌ |
| different owner | ❌ (excluded in SQL — never even decrypted) |

### 13.8 Scenario: forget / delete

```ts
// Relayer endpoint POST /api/forget removes vector index rows -> memory becomes unrecallable.
// NOTE: the encrypted Walrus blob persists until its epoch expiry; this is index-level deletion.
```

### 13.9 Scenario: recover the index from Walrus (`restore`)

If the relayer's Postgres index is lost, rebuild it from the source-of-truth blobs on Walrus:

```ts
const r = await memwal.restore("my-app", 50);  // inspect newest-50 blobs, re-index missing ones
// -> { restored, skipped, total, namespace, owner }
```
Single-shot (no cursor), `limit` defaults to 10, latency ~seconds/blob (10 concurrent Walrus downloads, 3 concurrent Seal decrypts). Undecryptable blobs are silently dropped (counted in neither `restored` nor `skipped`).

### 13.10 Scenario: memory-augmented Q&A (`ask`)

The relayer also exposes an `ask` flow (`POST /api/ask`) — it recalls relevant memories and answers a question against them in one call (RAG over your memory space), rather than returning raw memories for you to stuff into a prompt yourself. Pairs naturally with `analyze` (write path) for a full read/write memory loop.

### 13.11 Scenario: client-side encryption (`MemWalManual`)

```ts
import { MemWalManual } from "@mysten-incubation/memwal/manual";

const manual = MemWalManual.create({
  key: process.env.MEMWAL_PRIVATE_KEY!,
  accountId: process.env.MEMWAL_ACCOUNT_ID!,
  serverUrl: "https://relayer-staging.memory.walrus.xyz",       // testnet/staging relayer
  packageId: "0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6", // testnet pkg (see §13.15)
  embeddingApiKey: process.env.OPENAI_API_KEY!,  // you run embeddings
  embeddingModel: "text-embedding-3-small",      // default; 1536 dims
  suiPrivateKey: process.env.SUI_PRIVATE_KEY,    // or walletSigner for a connected wallet
  suiNetwork: "testnet",
});
// rememberManual: embed locally -> Seal-encrypt locally -> send ciphertext + vector to relayer
// recallManual:   embed locally -> relayer searches -> download from Walrus -> Seal-decrypt locally
// The relayer NEVER sees plaintext in this mode (it relays upload + runs vector search only).
```
Note the trade-off: you supply the embedding API key and do the Seal work, so you carry that cost/complexity in exchange for the relayer never seeing plaintext.

### 13.12 Scenario: Vercel AI SDK — auto recall + save

```ts
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { withMemWal } from "@mysten-incubation/memwal/ai";

const model = withMemWal(openai("gpt-4o"), {
  key: process.env.MEMWAL_PRIVATE_KEY!, accountId: process.env.MEMWAL_ACCOUNT_ID!,
  serverUrl: "https://relayer-staging.memory.walrus.xyz", namespace: "chat",
  maxMemories: 5, autoSave: true, minRelevance: 0.3,
});

const result = streamText({ model, messages: [{ role: "user", content: "What do you remember about me?" }] });
// Before generation: recall() + inject as system message. After: analyze() + save facts (fire-and-forget).
```

### 13.13 Scenario: OpenClaw / NemoClaw agent plugin

```bash
openclaw plugins install @mysten-incubation/oc-memwal
```
```jsonc
// ~/.openclaw/openclaw.json
{ "plugins": {
    "slots": { "memory": "oc-memwal" },
    "entries": { "oc-memwal": { "enabled": true, "config": {
      "privateKey": "${MEMWAL_PRIVATE_KEY}", "accountId": "0x...",
      "serverUrl": "https://relayer-staging.memory.walrus.xyz" } } } } }
```
Hooks run automatically: `before_prompt_build` (inject memories), `before_reset` (save summary), `agent_end` (capture last response).

### 13.14 Scenario: MCP + Python

- **MCP:** native MCP support means you can wire Walrus Memory into Claude Code, Cursor, Codex, and Gemini CLI via a setup script (no adapter).
- **Python:** `pip install memwal` — mirrors the TS surface (`remember`, `recall`, `restore`, …). Use for Python agent stacks / data pipelines.

### 13.15 Scenario: self-hosting the relayer + on-chain contract IDs

The managed relayer at `relayer.memory.walrus.xyz` is the default, but the relayer is open and self-hostable — useful if judges value avoiding the centralized-relayer dependency. It authenticates every request with an **Ed25519 signature** over `{timestamp}.{method}.{path_and_query}.{body_sha256}.{nonce}.{account_id}` (headers `x-public-key`, `x-signature`, `x-timestamp`, `x-nonce`, `x-account-id`, plus `x-seal-session` for decrypt). Routes: `/api/remember`, `/api/recall`, `/api/analyze`, `/api/ask`, `/api/restore`, `/api/forget`, plus `/api/remember|recall/manual` and unauthenticated `/health`, `/version`.

Required env to self-host: `DATABASE_URL` (Postgres with `pgvector`), `MEMWAL_PACKAGE_ID`, `MEMWAL_REGISTRY_ID`, `SERVER_SUI_PRIVATE_KEY`, `OPENAI_API_KEY`; optional `SEAL_SERVER_CONFIGS` / `SEAL_KEY_SERVERS`.

**Deployed contract IDs (verified from the docs):**
```
# Testnet (staging)  ← use these for the hackathon
MEMWAL_PACKAGE_ID  = 0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6
MEMWAL_REGISTRY_ID = 0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437

# Mainnet (production) — switch to these only when you ship
MEMWAL_PACKAGE_ID  = 0xcee7a6fd8de52ce645c38332bde23d4a30fd9426bc4681409733dd50958a24c6
MEMWAL_REGISTRY_ID = 0x0da982cefa26864ae834a8a0504b904233d49e20fcc17c373c8bed99c75a7edd
```

### 13.16 Why this matters for Sui Overflow 2026

AI-agent memory is *the* headline narrative and Walrus is the Headline Partner — a project built **on** Walrus Memory (or extending it) rides that theme directly. Strong angles: portable agent identity, an AI assistant that remembers a customer across sessions, shared-memory multi-agent coordination, or a verifiable memory audit trail. Early teams already building on it: Allium, Conso Labs, Inflectiv, OpenGradient, Talus Labs, Tatum.

**Caveats to verify before you depend on them:** it's **beta**; the vector index is a **centralized relayer + Postgres** (decentralization is at the blob layer, not the index — call this out honestly if judges ask); default mode means **the relayer sees plaintext** (use `MemWalManual` if that's unacceptable); `forget` is **index-level only** (blobs persist to epoch expiry). The repo's own links point to `github.com/CommandOSSLabs/MemWal` in places while the canonical source is `github.com/MystenLabs/MemWal` — confirm the live repo before pinning.

---

## Primary sources

- **Walrus Memory / MemWal:** [memory.walrus.xyz](https://memory.walrus.xyz/) · [product page](https://walrus.xyz/products/walrus-memory/) · [MystenLabs/MemWal repo](https://github.com/MystenLabs/MemWal) · [npm `@mysten-incubation/memwal`](https://www.npmjs.com/package/@mysten-incubation/memwal) · [launch (Decrypt)](https://decrypt.co/369895/walrus-memory-enables-ai-agents-to-actually-learn-about-us-mysten-labs-co-founder)
- **Hackathon:** [overflow.sui.io](https://overflow.sui.io/) · [2025 winners](https://blog.sui.io/2025-sui-overflow-hackathon-winners/) · [Sui Overflow 2025 (Devfolio)](https://sui-overflow-2025.devfolio.co/)
- **Protocol / design:** [Whitepaper (arXiv 2505.05370)](https://arxiv.org/abs/2505.05370) · [How blob storage works](https://blog.walrus.xyz/how-walrus-blob-storage-works/) · [RedStuff encoding](https://blog.walrus.xyz/how-walrus-red-stuff-encoding-works/) · [Mysten announcement](https://www.mystenlabs.com/blog/announcing-walrus-a-decentralized-storage-and-data-availability-protocol)
- **Docs:** [docs.wal.app](https://docs.wal.app/) (CLI, web API, setup, quilt, storage-costs) · [docs.sui.io — Walrus](https://docs.sui.io/sui-stack/walrus)
- **SDK / code:** [sdk.mystenlabs.com/walrus](https://sdk.mystenlabs.com/walrus) · [MystenLabs/walrus](https://github.com/MystenLabs/walrus) · [MystenLabs/ts-sdks](https://github.com/MystenLabs/ts-sdks) · [MystenLabs/awesome-walrus](https://github.com/MystenLabs/awesome-walrus)
- **Seal:** [MystenLabs/seal](https://github.com/MystenLabs/seal) · [Seal mainnet launch](https://www.mystenlabs.com/blog/seal-mainnet-launch-privacy-access-control) · [Seal brings access control to Walrus](https://blog.walrus.xyz/seal-brings-data-access-control-to-walrus/)
- **Walrus Sites:** [MystenLabs/walrus-sites](https://github.com/MystenLabs/walrus-sites) · [example-walrus-sites](https://github.com/MystenLabs/example-walrus-sites)
- **Tools:** [Tusky](https://tusky.io) · [cost calculator](https://costcalculator.wal.app)
