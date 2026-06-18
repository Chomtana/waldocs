# waldocs — Design Spec

**Date:** 2026-06-17 (rev. 3)
**Status:** Approved design → ready for implementation planning
**Target:** Sui Overflow 2026 (Walrus track) hackathon MVP
**Companion reference:** `walrus-implementation-guide.md` (§13 Walrus Memory / MemWal)

---

## 1. Summary

**waldocs** is a unified developer-documentation platform whose protocol docs **improve themselves from real app usage**. A contributor runs the Claude Code skill `waldocs-publish` in their app's repo; the skill sends the app's **step-by-step markdown** to the backend. The backend uses **Gemini (`gemini-3.1-flash-lite` via the Vercel AI SDK)** to:

1. **structure** the app's markdown into modular steps,
2. **merge** that knowledge into each protocol the app uses (keeping the protocol doc unchanged if the app doesn't improve it),
3. **curate** each protocol's showcase of notable apps.

Docs (app steps and synthesized protocol units) are stored on **Walrus Memory** (decentralized, verifiable, searchable) and indexed in **PostgreSQL**. A **Next.js** app serves the APIs and a browse UI, including a Gemini-powered global chat.

### Two core indexes
- **Protocols** — infrastructure that needs dev docs (e.g. "Walrus", "Sui", "Seal"). **Pure merge targets**: auto-created as stubs on first reference; all content is synthesized by merging app contributions. Curated simple slug.
- **Applications** — projects that **use** protocols. Identified by their git repo: slug `<author>/<repo>`.

### The modular-unit principle
The smallest documentation unit is a **doc unit** — modular, covering exactly one feature (protocol) or one step (app), written as **one Walrus Memory `remember()`**. Read top-to-bottom, the units form a working walkthrough.

---

## 2. Goals / Non-goals

### Goals (v1)
- `waldocs-publish` skill posts **app step-by-step markdown** → backend Gemini pipeline (structure → merge into protocols → curate showcase) → Walrus + Postgres.
- Browse UI: home with **Gemini global chat** + protocol list; **protocol page** (grouped sidebar + curated showcase); **app page** (ordered steps).
- Everything on **testnet / staging**.

### Non-goals (deferred)
- Auth / accounts (open / no-auth v1).
- Direct protocol publishing/seeding (protocols are merge-only).
- Doc diffs, edit/delete UI, `forget`-on-republish, per-entity Sui accounts.
- Human moderation beyond a soft rate limit + audit log.

---

## 3. Key design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Publish input | **App step-by-step markdown only** | Skill stays thin; backend owns structuring/merging. |
| Protocol origin | **Pure merge targets** (stub on first reference) | All protocol content synthesized from app contributions, incl. an auto-generated GETTING STARTED. No second publish flow. |
| Protocol identity | Curated slug; namespace `proto.<slug>` | Versioned by accepted merge. |
| Application identity | git `<author>/<repo>` slug; namespace `<author>/<repo>/<commit>` | Identity from repo (never guessed); each commit its own namespace; latest commit shown. |
| LLM | **Gemini `gemini-3.1-flash-lite` via Vercel AI SDK** for structure, merge, showcase curation, and chat | One provider; structured output via `generateObject` + zod. |
| Merge strategy | **Whole-doc merge**: (current protocol doc + app doc) → updated doc OR "no change" | Simple, idempotent, testable; protects good content via the no-change path. |
| Showcase curation | **On publish, cached** | Gemini picks notable, simple-first, dedups correlated apps, assigns short descriptive titles; stored in `showcase_entries`. Fast reads. |
| Doc granularity | Modular unit = one `remember()` | Protocols: unit per feature in sidebar sections; apps: unit per step. |
| Chat / ask | **Gemini RAG** over Walrus recall (drop MemWal `ask`) | We control retrieval + synthesis; avoids depending on MemWal's beta `ask`. |
| Isolation | Single account; namespace per entity-version; `_toc` for discovery | Per guide §13. |
| Metadata + render | Postgres holds structure/order + plaintext cache; Walrus holds encrypted text + embeddings | Postgres is render path; Walrus is verifiable + semantic source of truth. |
| Auth / network | Open / no-auth; testnet + staging relayer | Hackathon. |
| Publisher | Claude Code **skill** | Lighter than a plugin. |

---

## 4. Architecture

```
┌───────────────────────────┐  POST /api/publish (app markdown)  ┌──────────────────────────────┐
│ Claude Code skill         │ ─────────────────────────────────▶ │  Next.js backend (apps/web)  │
│  waldocs-publish          │   { entity(slug=author/repo,        │   Gemini pipeline:           │
│  - derive slug+commit     │     commit), markdown,              │   1 structure app doc        │
│    from git               │     usesProtocols }                 │   2 merge into each protocol │
│  - send step-by-step .md  │ ◀───────────────────────────────── │   3 curate showcase          │
└───────────────────────────┘   { url, version, blobIds }        │   + lib/memwal, Prisma       │
                                                                   └─────┬──────────┬────────┬─────┘
                                                                         │          │        │
                                                       @mysten-incubation/memwal   SQL   Vercel AI
                                                                         │          │      (Gemini)
                                                              ┌──────────▼─┐  ┌─────▼────┐  │
                                                              │  Walrus    │  │ Postgres │  │
                                                              │  Memory    │  │          │  │
                                                              └────────────┘  └──────────┘  │
                                                                       ┌─────────────────────▼──┐
                                                                       │ Google Generative AI    │
                                                                       └─────────────────────────┘
```

---

## 5. Data model (PostgreSQL)

```sql
protocols(
  id, slug unique,            -- "walrus" (curated)
  name, description, category,
  namespace,                  -- "proto.<slug>"
  toc_blob_id, created_at, updated_at
)

applications(
  id, slug unique,            -- "<author>/<repo>", e.g. "chomtana/waldocs"
  author, repo,               -- parsed from slug at publish
  name, description,
  namespace,                  -- LATEST: "<author>/<repo>/<commit>"
  latest_commit, repo_url, toc_blob_id,
  created_at, updated_at
)

application_protocols(application_id, protocol_id, primary key(both))  -- raw "uses" links

documents(
  id, entity_type, entity_id,
  version,                    -- monotonic per entity (latest renders); protocols bump per accepted merge
  commit_hash,               -- apps only
  namespace,                 -- namespace this version was written to
  title, summary, source_markdown,   -- source_markdown = app's submitted .md (apps only)
  created_at
)

doc_units(
  id, document_id, ord,
  group_title,               -- protocols: sidebar section; apps: null (steps)
  title, content_cache, walrus_blob_id, namespace, created_at
)

showcase_entries(            -- curated, notable subset per protocol (rebuilt on publish)
  id, protocol_id, application_id,
  descriptive_title,         -- e.g. "Unified document application" (NOT <author>/<repo>)
  simplicity_rank,           -- 0 = simplest first
  cluster_key,               -- correlated apps share a key; only one per cluster is kept
  created_at
)

publish_events(id, entity_type, entity_id, document_id, created_at, meta jsonb)
```

**Namespaces:** protocol-version → `proto.<slug>`; app-version → `<author>/<repo>/<commit>`; `_toc` → one summary memory per entity (`"[protocol:walrus] …"` / `"[application:chomtana/waldocs] …"`).

**Mandatory protocol structure (Gemini-maintained):** the synthesized protocol doc always contains a `GETTING STARTED` group with units `Introduction` and `Getting Started`, then body groups, with each unit covering one feature.

---

## 6. Gemini layer (`lib/llm.ts`, injectable `LlmPort`)

Vercel AI SDK + Google provider; model id from `GEMINI_MODEL` (`gemini-3.1-flash-lite`). All calls use `generateObject` with a zod schema.

- `structureAppDoc(markdown): Promise<{ name: string; summary: string; steps: { title: string; content: string }[] }>`
  Breaks the app's markdown into ordered modular steps + a 1–3 sentence summary + a human title.
- `mergeProtocolDoc(args: { protocolName: string; currentDoc: GroupedUnit[]; appName: string; appSteps: { title: string; content: string }[] }): Promise<{ changed: boolean; doc?: GroupedUnit[]; summary?: string; description?: string }>`
  Returns an updated full protocol doc when the app **improves** it (must keep GETTING STARTED→Introduction/Getting Started), else `{ changed: false }`.
- `curateShowcase(args: { protocolName: string; candidates: { slug: string; name: string; summary: string }[] }): Promise<{ entries: { slug: string; descriptiveTitle: string; simplicityRank: number; clusterKey: string }[] }>`
  Selects notable apps, simplest-first, one per `clusterKey` (drops correlated duplicates), with a short descriptive title.
- `answerOverContext(args: { question: string; context: { label: string; text: string }[] }): Promise<{ answer: string; usedLabels: string[] }>`
  RAG synthesis for chat + per-entity ask.

`GroupedUnit = { group: string | null; title: string; content: string }`.

---

## 7. Publish pipeline — `POST /api/publish` (app-only)

### 7.1 Request/response contract
```jsonc
// POST /api/publish
{
  "entity": {
    "type": "application",
    "slug": "chomtana/waldocs",                 // ^[^/]+/[^/]+$ (from git remote)
    "name": "waldocs",                          // optional; Gemini may set if omitted
    "description": "…", "repoUrl": "https://github.com/chomtana/waldocs",
    "commitHash": "a7d490d"                      // required (git rev-parse HEAD)
  },
  "markdown": "## Step 1: Install\n…\n## Step 2: …",  // step-by-step app docs
  "usesProtocols": ["walrus", "sui"]
}
```
```jsonc
// 200 OK
{ "url": "https://<host>/app/chomtana/waldocs", "slug": "chomtana/waldocs",
  "documentId": "…", "version": 1, "namespace": "chomtana/waldocs/a7d490d",
  "blobIds": ["…"], "tocBlobId": "…",
  "mergedProtocols": [ { "slug": "walrus", "changed": true }, { "slug": "sui", "changed": false } ] }
```

### 7.2 Backend steps
1. **Validate** (zod): `type=application`, slug `^[^/]+/[^/]+$`, `commitHash`, non-empty `markdown`, `usesProtocols`.
2. **Structure app doc:** `llm.structureAppDoc(markdown)` → `{ name, summary, steps }`.
3. **Store app:** namespace `<slug>/<commit>`; upsert application (parse `author`/`repo` from slug, set `namespace`+`latest_commit`); create `documents` (version+1, commit_hash, namespace, source_markdown, summary); for each step `rememberAndWait(content, ns)` → `doc_units` (group null, ord); write app `_toc`.
4. **Merge into each used protocol:** for each slug in `usesProtocols`:
   - upsert stub protocol if missing (namespace `proto.<slug>`); link `application_protocols`.
   - load current protocol doc (latest version units) as `GroupedUnit[]`.
   - `llm.mergeProtocolDoc({ protocolName, currentDoc, appName, appSteps })`.
   - if `changed`: create protocol `documents` (version+1, namespace `proto.<slug>`, summary), write each unit `rememberAndWait(content, protoNs)` → `doc_units` (group_title set, ord), update protocol `description` + `_toc`. Else: leave unchanged.
5. **Curate showcase** for each affected protocol: candidates = all linked apps (`{slug, name, summary}`); `llm.curateShowcase(...)` → replace that protocol's `showcase_entries`.
6. **Audit:** insert `publish_events`. Return the contract (incl. per-protocol `changed`).

> Publish performs several Gemini + Walrus calls (1 structure + N merges + M curations). Acceptable for v1; the skill shows progress and the endpoint may take seconds.

---

## 8. Read / browse + API

### UI pages
- **`/` (home):** **Gemini chat box on top** (`POST /api/chat`); below, **protocol list** sorted `created_at ASC` with name + short description.
- **`/protocol/[slug]`:** **sidebar** from `doc_units.group_title` in order — `GETTING STARTED` (Introduction, Getting Started) first, body groups next, **`SHOWCASE`** last from `showcase_entries` (descriptive titles, simplest-first, linking to app pages). Body renders units; per-protocol "Ask these docs" (`/api/ask`).
- **`/app/[author]/[repo]`:** single page, latest-commit `doc_units` as an **ordered step-by-step** sequence; linked protocols; per-app "Ask these docs".

### API (Next.js route handlers)
- `POST /api/publish` — §7.
- `GET /api/protocols` — list, `created_at ASC`.
- `GET /api/protocols/:slug` — grouped sections + curated showcase.
- `GET /api/applications/:author/:repo` — latest-commit steps + linked protocols.
- `POST /api/chat` — **global** Gemini RAG: two-stage retrieve (`recall(_toc)` → top ~3 entities → `recall` each namespace) → `answerOverContext` → `{ answer, citations }`.
- `POST /api/ask` — per-entity Gemini RAG: `recall(entityNamespace)` → `answerOverContext`.
- `GET /api/healthz` — relayer `health()` + DB ping.

---

## 9. Walrus Memory + env

- SDK `@mysten-incubation/memwal` wrapped in `lib/memwal.ts` (`MemwalPort` = `remember` + `recall` + `health`; no `ask`).
- Gemini in `lib/llm.ts` (`LlmPort`) via the **Vercel AI Gateway** (`ai` SDK 5; `gateway("google/<model>")`).
- Env (server-only): `MEMWAL_PRIVATE_KEY`, `MEMWAL_ACCOUNT_ID`, `MEMWAL_SERVER_URL=https://relayer-staging.memory.walrus.xyz`, `MEMWAL_PACKAGE_ID`/`MEMWAL_REGISTRY_ID` (testnet), `DATABASE_URL`, `AI_GATEWAY_API_KEY` (or Vercel OIDC on deploy), `GEMINI_MODEL=gemini-3.1-flash-lite`, `OWNER_SUI_KEY` (seed only).
- One-time bootstrap: `scripts/seed-account.ts` (testnet).
- Rendering uses Postgres `content_cache`; retrieval uses `recall`; synthesis uses Gemini; verifiability from persisted `walrusBlobId`s.

---

## 10. Repo structure (monorepo)

```
waldocs/
  apps/web/
    src/lib/{types,validation,db,repo,memwal,llm,publish,merge,showcase,chat,toc,queries}.ts
    src/app/api/**/route.ts
    src/app/page.tsx
    src/app/protocol/[slug]/page.tsx
    src/app/app/[author]/[repo]/page.tsx
    src/app/_components/{ChatBox,AskBox,Sidebar}.tsx
    prisma/schema.prisma
    .env.example                 # env template (copy to apps/web/.env)
  scripts/seed-account.ts
  packages/skill/waldocs-publish/SKILL.md
  docker-compose.yml
```

---

## 11. Testing strategy

- **Unit (deterministic, all ports faked — `MemwalPort`, `RepoPort`, `LlmPort`):**
  - publish pipeline: app structuring path, namespace resolution (`proto.<slug>` vs `<slug>/<commit>`), author/repo parse, stub-protocol creation, merge **changed → writes new protocol version** vs **unchanged → no writes**, showcase rebuild, `_toc` writes.
  - merge orchestration: `changed:false` leaves protocol untouched.
  - showcase: one entry per `clusterKey`, ordered by `simplicityRank`.
  - chat/ask: two-stage retrieval assembles context; citations map to `usedLabels`.
  - toc encode/decode incl. slashed app slugs.
- **Integration:** repo + queries vs local Postgres (grouped read, latest-commit steps, showcase read).
- **Route:** publish/chat/ask handlers with mocked libs.
- **Build/manual:** UI pages, seed script, skill.

> `LlmPort` is faked in tests with canned structured objects — no live Gemini calls in unit tests.

---

## 12. Risks / open caveats

- **LLM cost/latency/nondeterminism:** each publish = 1 structure + N merges + M curations. Cap fan-out (chat top ≈3 entities). Keep prompts tight; use `generateObject` for schema safety.
- **Merge could regress a protocol doc:** mitigated by the explicit improve-or-no-change contract + retained version history (rollback = render an earlier `documents` version).
- **MemWal beta** — isolated in `lib/memwal.ts`.
- **Append-only Walrus** — stale memories persist across versions/commits; `_toc` may hold multiple entries per app (dedup by slug on recall, prefer latest).
- **Open publish endpoint** — soft rate limit + `publish_events`.
- **`MystenLabs/MemWal` vs `CommandOSSLabs/MemWal`** ambiguity (guide §13.16) — confirm canonical npm source.
- **Gemini model id** `gemini-3.1-flash-lite` taken as given — confirm the gateway slug `google/gemini-3.1-flash-lite` resolves before pinning.
