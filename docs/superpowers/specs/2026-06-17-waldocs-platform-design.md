# waldocs — Design Spec

**Date:** 2026-06-17
**Status:** Approved design → ready for implementation planning
**Target:** Sui Overflow 2026 (Walrus track) hackathon MVP
**Companion reference:** `walrus-implementation-guide.md` (§13 Walrus Memory / MemWal)

---

## 1. Summary

**waldocs** is a unified developer-documentation platform. Contributors run a Claude Code slash command, **`/waldocs-publish`**, inside any repository; Claude synthesizes a structured dev-doc from that repo and publishes it to the platform. Documents are stored on **Walrus Memory** (decentralized, verifiable, semantically searchable) and indexed in **PostgreSQL**. A **Next.js** application exposes both the **HTTP APIs** and a **browse UI**.

The plugin never touches Walrus Memory directly. It only calls the Next.js backend, which owns the Walrus Memory delegate key and performs all reads/writes.

### Two core indexes
- **Protocols** — infrastructure, or a notable application with its own ecosystem of integrations, that needs dev docs (e.g. "Sui", "Walrus", "Seal").
- **Applications** — projects (typically hackathon builds) that **use** one or more protocols.

An application links to one or more protocols (many-to-many).

---

## 2. Goals / Non-goals

### Goals (v1, hackathon)
- `/waldocs-publish` end-to-end: repo → Claude-generated structured doc → stored on Walrus Memory → indexed in Postgres → updated central table-of-contents.
- Browse UI listing the two indexes, an entity detail page rendering the doc, and global semantic search.
- Per-entity semantic Q&A ("ask these docs").
- Everything on **testnet / staging** (per `walrus-implementation-guide.md` hackathon convention).

### Non-goals (explicitly deferred — YAGNI)
- Authentication / user accounts (v1 is open / no-auth).
- Doc versioning, diffs, or edit/delete UI.
- Per-entity Sui accounts or self-hosted relayer.
- Moderation / spam control beyond a soft rate limit and an audit log.
- Wallet-signature publishing.

---

## 3. Key design decisions (with rationale)

| Decision | Choice | Rationale |
|---|---|---|
| Isolation model | **Single backend-owned MemWalAccount; one namespace per entity** | `account::create_account` enforces one account per Sui owner address. Namespaces give relayer-enforced isolation (`owner + namespace`, cross-namespace never decrypted) with near-zero key/gas overhead. |
| Central TOC | **Reserved `_toc` namespace** in the same account | Functionally equivalent to a "central account" for discovery; avoids a second funded key. Promotable to its own account later. |
| Doc granularity | **Chunk by section**, one `remember()` per section | Walrus Memory is text-memory-optimized (not large blobs); section chunks make `recall`/`ask` far more accurate than one giant memory. |
| Where docs are generated | **In the plugin (Claude)**, backend stores only | Leverages Claude Code's strength; backend needs no LLM key and stays simple. |
| Metadata + rendering | **Postgres** holds all structure/relationships/order + a **plaintext cache**; Walrus holds encrypted text + embeddings | The default MemWal client has no tags param and searches by meaning, not get-by-id-in-order. Postgres is the fast/ordered render path; Walrus is the verifiable + semantic source of truth (we persist every `walrus_blob_id`). |
| Auth | **Open / no-auth** for v1 | Fastest demo path; record `publish_events` for later attribution; add a soft rate limit. |
| Network | **Testnet + staging relayer** | Hackathon convention. |

---

## 4. Architecture

```
┌─────────────────────┐      POST /api/publish        ┌──────────────────────────────┐
│  Claude Code plugin │ ────────────────────────────▶ │  Next.js backend (apps/web)  │
│  /waldocs-publish   │      JSON: doc sections,       │  - route handlers (APIs)     │
│  (Claude synthesizes│      summary, entity, links    │  - lib/memwal.ts (SDK wrap)  │
│   doc from repo)    │ ◀──────────────────────────── │  - Prisma/Drizzle → Postgres │
└─────────────────────┘      { url, blobIds }          │  - browse UI (React)         │
                                                        └───────────┬───────────┬──────┘
                                                                    │           │
                                              @mysten-incubation/memwal     SQL │
                                                                    │           │
                                                          ┌─────────▼──┐   ┌────▼─────────┐
                                                          │  Walrus    │   │ PostgreSQL   │
                                                          │  Memory    │   │ (our index + │
                                                          │ (staging   │   │  cache)      │
                                                          │  relayer)  │   └──────────────┘
                                                          └────────────┘
```

The backend holds **one delegate key + account ID** (server-only env) and talks to the **staging relayer** (`relayer-staging.memory.walrus.xyz`). The relayer internally embeds (OpenAI `text-embedding-3-small`, 1536-dim), Seal-encrypts, uploads to Walrus, and stores vectors in its own pgvector — none of which we manage. **Our** Postgres is a separate, platform-owned database.

---

## 5. Data model (PostgreSQL)

```sql
-- The two core indexes
protocols(
  id           uuid pk,
  slug         text unique,          -- e.g. "walrus"
  name         text,
  category     text,                 -- e.g. "storage", "defi", "infra"
  description  text,
  namespace    text,                 -- "proto.<slug>"
  toc_blob_id  text,                 -- Walrus blob id of its _toc summary memory
  created_at   timestamptz,
  updated_at   timestamptz
)

applications(
  id           uuid pk,
  slug         text unique,          -- e.g. "waldocs"
  name         text,
  description  text,
  namespace    text,                 -- "app.<slug>"
  toc_blob_id  text,
  repo_url     text,
  created_at   timestamptz,
  updated_at   timestamptz
)

application_protocols(                -- M:N: an app uses protocols
  application_id uuid fk,
  protocol_id    uuid fk,
  primary key (application_id, protocol_id)
)

documents(
  id           uuid pk,
  entity_type  text,                 -- "protocol" | "application"
  entity_id    uuid,                 -- fk to protocols.id or applications.id
  title        text,
  version      int,                  -- monotonically increasing per entity (latest wins for render)
  repo_url     text,
  summary      text,                 -- short summary (also written to _toc)
  created_at   timestamptz
)

doc_chunks(
  id            uuid pk,
  document_id   uuid fk,
  ord           int,                 -- section order for rendering
  section_title text,
  content_cache text,                -- plaintext for fast ordered render
  walrus_blob_id text,               -- proof the chunk is on Walrus
  namespace     text,                -- entity namespace it was written to
  created_at    timestamptz
)

publish_events(
  id           uuid pk,
  entity_type  text,
  entity_id    uuid,
  document_id  uuid,
  created_at   timestamptz,
  meta         jsonb                 -- repo_url, chunk_count, client info
)
```

**Namespace conventions (Walrus Memory):**
- `proto.<slug>` — section memories for a protocol's current doc.
- `app.<slug>` — section memories for an application's current doc.
- `_toc` — exactly one summary memory per entity; content begins with a machine-parseable header line, e.g. `"[protocol:walrus] Walrus — decentralized blob storage…"`, so `recall` hits map back to an entity.

> Note on re-publish: v1 treats publish as **append** (MemWal `remember` is always append, never upsert — see guide §13.7). On re-publish we create a new `documents` row with `version+1`; the UI renders the **latest** version's chunks. Older Walrus memories persist (acceptable for v1; `forget` is a later enhancement).

---

## 6. Publish pipeline — `/waldocs-publish`

### 6.1 Plugin responsibilities (Claude)
1. Parse optional args: `--as protocol|application`, `--slug <slug>`, `--name <name>`. If absent, infer from the repo and **confirm interactively** before sending.
2. Gather repo context: `README*`, package manifests (`package.json`, `Cargo.toml`, `Move.toml`, …), key source files, and the current session.
3. Synthesize:
   - `sections`: ordered array of `{ section_title, content }` (e.g. Overview, Install, Usage, API, Examples, Notes).
   - `summary`: 1–3 sentence summary for the TOC.
   - `entity`: `{ type, slug, name, description, category? , repo_url }`.
   - `uses_protocols` (applications only): array of protocol slugs the project integrates.
4. `POST /api/publish` with the payload. Render the returned URL + blob count to the user.

### 6.2 Publish request/response contract

```jsonc
// POST /api/publish
{
  "entity": {
    "type": "application",            // "protocol" | "application"
    "slug": "waldocs",
    "name": "waldocs",
    "description": "Unified dev-docs platform on Walrus Memory.",
    "category": null,                 // protocols only
    "repoUrl": "https://github.com/…"
  },
  "summary": "waldocs lets devs publish repo docs to a decentralized, searchable platform.",
  "sections": [
    { "title": "Overview", "content": "…" },
    { "title": "Install",  "content": "…" }
  ],
  "usesProtocols": ["walrus", "sui"]  // applications only; ignored for protocols
}
```
```jsonc
// 200 OK
{
  "url": "https://<host>/app/waldocs",
  "entityType": "application",
  "slug": "waldocs",
  "documentId": "…",
  "version": 1,
  "blobIds": ["…", "…"],
  "tocBlobId": "…"
}
```

### 6.3 Backend pipeline (`POST /api/publish`)
1. Validate payload (zod). Reject empty `sections`.
2. Resolve namespace: `proto.<slug>` or `app.<slug>`. Upsert the entity row (set `namespace`).
3. Create `documents` row (`version = previous + 1`).
4. For each section, in order: `memwal.rememberAndWait(content, namespace, { timeoutMs })` → persist a `doc_chunks` row with `walrus_blob_id`, `content_cache`, `ord`, `section_title`.
5. Write/refresh the `_toc` memory: `rememberAndWait("[<type>:<slug>] <name> — <summary>", "_toc")` → store `toc_blob_id` on the entity.
6. For applications: upsert `application_protocols` (auto-create stub protocol rows for unknown slugs so links never dangle).
7. Insert `publish_events`.
8. Return the contract response.

Failure handling: the pipeline is best-effort sequential; if a section write fails, return `207`-style partial result with the chunks that succeeded and an `errors[]` array. Postgres writes for a given chunk happen only after its Walrus write resolves, so the DB never references a missing blob.

---

## 7. Read / browse + API

### API (Next.js route handlers, `apps/web/app/api/**`)
- `POST /api/publish` — §6.
- `GET /api/protocols` · `GET /api/applications` — list the two indexes (Postgres).
- `GET /api/protocols/:slug` · `GET /api/applications/:slug` — entity detail: latest document, ordered chunks (`content_cache`), linked protocols (apps), `blobIds`.
- `POST /api/search` — `{ query }` → `memwal.recall({ query, namespace: "_toc", maxDistance })` → parse `[type:slug]` headers → return matching entities (joined with Postgres for display).
- `POST /api/ask` — `{ entityType, slug, question }` → relayer `/api/ask` scoped to that entity's namespace → answer + source memories.
- `GET /api/healthz` — relayer `health()` + DB ping.

### UI pages (`apps/web/app/**`)
- `/` — home: two lists (Protocols, Applications) + a global search box (calls `/api/search`).
- `/protocol/[slug]` — renders the doc from ordered `content_cache`; shows applications that use it; "Ask these docs" box (`/api/ask`).
- `/app/[slug]` — renders the doc; shows linked protocols; "Ask these docs" box.

---

## 8. Walrus Memory integration details

- SDK: `@mysten-incubation/memwal` (default `MemWal` client). Wrapper in `apps/web/lib/memwal.ts` builds a singleton from env.
- Env (server-only): `MEMWAL_PRIVATE_KEY` (delegate, hex), `MEMWAL_ACCOUNT_ID`, `MEMWAL_SERVER_URL=https://relayer-staging.memory.walrus.xyz`, `MEMWAL_PACKAGE_ID`/`MEMWAL_REGISTRY_ID` (testnet, see guide §13.15), `DATABASE_URL`, `OWNER_SUI_KEY` (seed script only).
- One-time bootstrap: `scripts/seed-account.ts` → `generateDelegateKey()` → `createAccount({ …, suiNetwork: "testnet" })` → `addDelegateKey(...)`; prints `MEMWAL_PRIVATE_KEY` + `MEMWAL_ACCOUNT_ID` to put in `.env`. Owner address must hold testnet SUI (faucet).
- Reads for rendering use Postgres `content_cache`; reads for discovery/Q&A use `recall`/`ask`. We never reconstruct full ordered docs from Walrus directly (the default client is semantic, not get-by-id). Verifiability is provided by persisted `walrus_blob_id`s.

---

## 9. Repo structure (monorepo)

```
waldocs/
  apps/web/                     # Next.js (App Router): UI + API routes
    app/                        #   pages + app/api/** route handlers
    lib/memwal.ts               #   MemWal client singleton
    lib/db.ts                   #   Prisma/Drizzle client
    prisma/ or drizzle/         #   schema + migrations
  packages/plugin/              # Claude Code plugin
    commands/waldocs-publish.md #   slash command + doc-synthesis instructions
    plugin.json                 #   plugin manifest
  scripts/seed-account.ts       # one-time MemWal account/delegate bootstrap
  docker-compose.yml            # local Postgres
  .env.example
```

---

## 10. Testing strategy

- **Backend unit:** publish pipeline with `lib/memwal.ts` mocked — asserts chunk ordering, namespace resolution, `application_protocols` linking, `_toc` write.
- **Backend integration:** `POST /api/publish` against the **staging relayer** + a disposable test Postgres; assert blobs return and entity becomes listable + searchable.
- **Plugin:** snapshot the synthesized payload shape against a sample repo (structure/required fields), not exact prose.
- **E2E (stretch):** publish → appears in `/api/applications` → found via `/api/search` → answerable via `/api/ask`.

---

## 11. Risks / open caveats

- **MemWal is beta**; SDK surface may shift. Pin versions; isolate all SDK calls in `lib/memwal.ts`.
- **Append-only re-publish** leaves stale section memories on Walrus across versions — acceptable for v1; revisit with `forget`.
- **Staging relayer availability / latency** (seconds per chunk) — keep docs modest; consider `rememberBulk` (≤20) to parallelize section writes if latency hurts the demo.
- **Open publish endpoint** is abusable — soft rate limit + `publish_events` audit only for v1.
- **`MystenLabs/MemWal` vs `CommandOSSLabs/MemWal`** repo ambiguity (guide §13.16) — confirm the canonical npm source before pinning.
