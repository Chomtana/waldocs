# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**waldocs** is a unified developer-docs platform where **protocol docs improve themselves from real app usage**. A contributor runs the `waldocs-publish` Claude Code skill in their app repo; it sends the app's step-by-step markdown to the backend, which uses an LLM (Gemini via OpenRouter) to (1) **structure** the app doc, (2) **merge** useful knowledge into the docs of each protocol the app uses, and (3) **curate** a showcase of notable apps. Docs are stored on **Walrus Memory** (decentralized, semantically searchable) and indexed in **Postgres**.

The full design + task history lives in `docs/superpowers/specs/` and `docs/superpowers/plans/` — read the spec (`2026-06-17-waldocs-platform-design.md`) for the authoritative model.

## Commands

pnpm monorepo. Everything runs through `apps/web`.

- **Dev server:** `pnpm dev` (root) → `next dev` on :3000.
- **Type-check (use this to verify, NOT `next build`):** `pnpm --filter web exec tsc --noEmit`
- **Tests:** `pnpm test` (root) or `pnpm --filter web test`. Run one file: `pnpm --filter web test <substring>` (e.g. `pnpm --filter web test publish`).
- **Watch:** `pnpm --filter web test:watch`
- **Postgres (required for integration tests + dev):** `docker compose up -d db`
- **Prisma migrate (run from `apps/web`):** `cd apps/web && npx prisma migrate dev`
- **One-time Walrus Memory account bootstrap (testnet):** `pnpm seed:account` (needs a funded `OWNER_SUI_KEY` in `apps/web/.env`).

### Critical operational rules (learned the hard way)

- **NEVER run `next build` (`pnpm --filter web build`) while `next dev` is running.** Both write `apps/web/.next`; the production build corrupts the dev server's chunks (`Cannot find module ./chunks/...`). To verify code while the dev server is up, use `tsc --noEmit` + vitest only.
- **Tests run against a SEPARATE database `waldocs_test`**, never the dev DB. The integration tests (`repo.test.ts`, `queries.test.ts`) `deleteMany()` every table in `beforeEach`; vitest points them at `waldocs_test` via `test.env.DATABASE_URL` (`vitest.config.ts`). First-time setup: create that DB and run `prisma migrate deploy` against it. Running tests against the dev DB will wipe published data.
- **Env is per-app at `apps/web/.env`** (copy from `apps/web/.env.example`), not the repo root — both Next.js and the Prisma CLI auto-load `.env` from the app dir (Prisma ignores `.env.local`).
- **Adding a dependency requires restarting `next dev`** (HMR doesn't pick up new `node_modules`).
- **Everything is testnet** — Walrus Memory **staging** relayer + testnet contract ids; OpenRouter for the LLM.

## Architecture

### The port pattern (key to the whole design)

All side-effecting collaborators are behind **injectable ports** defined in `apps/web/src/lib/types.ts`:

- **`MemwalPort`** → `lib/memwal.ts` (the `@mysten-incubation/memwal` Walrus Memory SDK)
- **`LlmPort`** → `lib/llm.ts` (Gemini via OpenRouter)
- **`RepoPort`** → `lib/repo.ts` (Prisma)

The business logic — `lib/publish.ts` (the pipeline) and `lib/chat.ts` (RAG) — takes these ports as **arguments**, so it is unit-tested with in-memory fakes (no DB, no network, no LLM). Route handlers (`src/app/api/**/route.ts`) are thin: they validate input and wire the **real** singletons (`repo`, `getMemwal()`, `getLlm()`) into the logic. When adding a feature, follow this seam: pure logic takes ports; routes inject real implementations.

### The publish pipeline (`lib/publish.ts` `publishApp` — the heart)

Publishing is **app-only**. For an app's submitted markdown:
1. `llm.structureAppDoc` → ordered modular **steps** (preserves the leading `## Environment` SDK-version block as the first step).
2. Write each step to Walrus (`memwal.remember`) under the **app namespace** `<author>/<repo>/<commit>`, cache in Postgres, write the app `_toc` summary.
3. For each protocol in `usesProtocols`: stub-upsert the protocol, then `llm.mergeProtocolDoc` (whole-doc, "improve or keep unchanged" — if `changed`, write the new protocol units under `proto.<slug>`). Then **always** `llm.curateShowcase` → `repo.replaceShowcase`.

**Modular-unit principle:** one doc unit = one Walrus Memory `remember()`. **Postgres** holds all structure/order/relationships + a plaintext **`contentCache`** for fast ordered rendering; **Walrus** holds the encrypted text + embeddings (the verifiable + semantic source of truth, referenced by `walrusBlobId`). Page rendering reads Postgres; search/ask read Walrus via `recall`.

**Writes are non-blocking** (so publish fits serverless timeouts): `memwal.remember()` enqueues and returns a `jobId` immediately (the relayer certifies on Walrus in the background — `rememberAndWait` is ~10s/write and would blow the function limit). `DocUnit.walrusBlobId` is therefore **nullable** and filled later: `POST /api/reconcile` (`lib/memwal.ts` `resolveJob` → `repo.pendingUnits`/`setUnitBlobId`) resolves pending `jobId`s to blob ids. Wire a cron/external ping to `/api/reconcile`. Rendering works immediately from `contentCache`; semantic search lags slightly until the relayer certifies.

### Namespaces (`lib/toc.ts`)

- Protocol version → `proto.<slug>`
- App version → `<author>/<repo>/<commit>`
- `_toc` → one summary memory per entity, header line `[<type>:<slug>] <name> — <summary>` (encode/decode in `toc.ts`). Powers discovery + the first stage of global chat.

### Chat / ask (`lib/chat.ts`) — Gemini RAG

`globalChat` is two-stage: `recall(_toc)` → top ~3 entities → `recall` each entity namespace → `llm.answerOverContext`. `entityAsk` is single-namespace. (MemWal's own `ask` is intentionally not used.)

### LLM specifics (`lib/llm.ts`) — non-obvious

- Uses **`generateText` + JSON-Schema-in-prompt + `extractJson` + zod-validate**, NOT `generateObject` — OpenRouter/Gemini didn't reliably honor native structured-output mode.
- `extractJson` slices the **outermost `{ … }`** (don't fence-strip — doc content is full of ```code blocks``` that live inside the JSON strings).
- `withRetry(gen, 3)` wraps the real generator (weak models intermittently fail schema).
- Model comes from `GEMINI_MODEL` (an OpenRouter slug, e.g. `google/gemini-3.1-flash-lite`); auth `OPENROUTER_API_KEY`.
- The prompts encode product rules: every doc unit **must** contain a runnable code/command example with realistic **mock values**, and **secrets** (private keys, API keys, account ids) must be **redacted** to a truncated form like `0x28bd…508b`. Keep these rules in sync between `lib/llm.ts` and `packages/skill/waldocs-publish/SKILL.md`.

### Walrus Memory / Sui gotchas (`lib/memwal.ts`, `apps/web/scripts/seed-account.ts`)

- The real relayer calls are **rate-limited in `buildClient`** (~2.2s spacing + 429 backoff): the staging relayer caps ~30 weighted-req/min per delegate key, and `rememberAndWait` is slow (~10s/write, it embeds + Seal-encrypts + uploads synchronously). A full multi-protocol publish therefore takes minutes — clients must use long timeouts; the route sets a high `maxDuration`.
- `@mysten/sui` 2.x removed the old `SuiClient` export, so the seed script constructs a `SuiJsonRpcClient` and passes it explicitly to `createAccount`/`addDelegateKey`.
- The seed script lives in `apps/web/scripts/` (not repo root) so ESM resolves `@mysten-incubation/memwal` from `apps/web/node_modules`.
- `lib/memwal.ts`/`lib/llm.ts` start with `import "server-only"`; vitest aliases `server-only` to `test/server-only-stub.ts` (`vitest.config.ts`).

### Frontend

Next.js App Router server components render doc `content` as markdown via `_components/Markdown.tsx` (`react-markdown` + `remark-gfm` + `rehype-highlight`). Styling/theming is plain CSS variables in `app/globals.css` (`:root[data-theme="dark"]`); the theme **defaults to dark** (set on `<html>` + a pre-paint script in `layout.tsx`), and `_components/ThemeToggle.tsx` persists an override to `localStorage`. vitest uses the **automatic JSX runtime** (`esbuild.jsx: "automatic"`) so `.tsx` components render in tests.
