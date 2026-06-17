# waldocs Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the waldocs platform — a Next.js backend + browse UI and a Claude Code `/waldocs-publish` plugin that publishes repo-generated dev-docs to Walrus Memory, indexed in Postgres.

**Architecture:** A Next.js (App Router) app hosts HTTP APIs and a React browse UI. The Claude Code plugin synthesizes a structured doc from a repo and POSTs it to `/api/publish`. The backend chunks the doc by section, writes each section to Walrus Memory (one namespace per entity) via the managed staging relayer, caches plaintext + metadata in Postgres, and maintains a central `_toc` namespace of summaries for discovery search. All business logic is injectable (memwal + repo ports) so it is unit-tested with fakes; UI/plugin/seed-script use build/run verification.

**Tech Stack:** TypeScript, Next.js 15 (App Router), PostgreSQL + Prisma, zod, `@mysten-incubation/memwal`, vitest, pnpm.

## Global Constraints

- **Network: testnet only.** Walrus Memory **staging** relayer `https://relayer-staging.memory.walrus.xyz`; `suiNetwork: "testnet"`; testnet contract IDs `MEMWAL_PACKAGE_ID=0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6`, `MEMWAL_REGISTRY_ID=0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437`.
- **One backend-owned MemWalAccount; one namespace per entity.** Namespaces: `proto.<slug>`, `app.<slug>`, reserved `_toc`.
- **The plugin never calls Walrus Memory directly** — only the Next.js backend does.
- **Delegate key is server-only.** Never import `lib/memwal.ts` into client components.
- **Auth: none in v1.** `/api/publish` is open; record `publish_events`.
- **Re-publish = append + version bump.** UI renders the latest `documents` version's chunks.
- **SDK is beta** — all MemWal SDK calls are isolated in `lib/memwal.ts`.
- Package manager: **pnpm**. Node ≥ 18.

---

## File Structure

```
waldocs/
  package.json                      # pnpm workspace root
  pnpm-workspace.yaml
  docker-compose.yml                # local Postgres
  .env.example
  apps/web/
    package.json
    next.config.ts
    tsconfig.json
    vitest.config.ts
    prisma/schema.prisma
    src/lib/types.ts                # domain types + ports (no deps)
    src/lib/validation.ts           # zod schema for publish payload
    src/lib/db.ts                   # Prisma client singleton
    src/lib/repo.ts                 # DB access (Prisma-backed) implementing RepoPort
    src/lib/memwal.ts               # MemWal SDK wrapper implementing MemwalPort
    src/lib/publish.ts              # publishDocument(input, {repo, memwal}) — core pipeline
    src/lib/toc.ts                  # _toc header encode/decode helpers
    src/app/api/publish/route.ts
    src/app/api/protocols/route.ts
    src/app/api/protocols/[slug]/route.ts
    src/app/api/applications/route.ts
    src/app/api/applications/[slug]/route.ts
    src/app/api/search/route.ts
    src/app/api/ask/route.ts
    src/app/api/healthz/route.ts
    src/app/page.tsx                # home: two indexes + search
    src/app/protocol/[slug]/page.tsx
    src/app/app/[slug]/page.tsx
    src/app/_components/AskBox.tsx
    test/*.test.ts                  # vitest unit tests
  scripts/seed-account.ts           # one-time MemWal account/delegate bootstrap
  packages/plugin/
    plugin.json
    commands/waldocs-publish.md
```

---

## Task 1: Workspace scaffold + tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `docker-compose.yml`, `.env.example`, `.gitignore`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/vitest.config.ts`
- Create: `apps/web/src/app/layout.tsx`, `apps/web/test/smoke.test.ts`

**Interfaces:**
- Produces: a buildable Next.js app under `apps/web`, `pnpm --filter web test` runs vitest.

- [ ] **Step 1: Create workspace root files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`package.json`:
```json
{
  "name": "waldocs",
  "private": true,
  "scripts": {
    "dev": "pnpm --filter web dev",
    "test": "pnpm --filter web test",
    "seed:account": "tsx scripts/seed-account.ts"
  },
  "devDependencies": { "tsx": "^4.19.0" }
}
```

`.gitignore`:
```
node_modules
.next
.env
.env.local
dist
```

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: waldocs
      POSTGRES_PASSWORD: waldocs
      POSTGRES_DB: waldocs
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes: { pgdata: {} }
```

`.env.example`:
```
DATABASE_URL=postgresql://waldocs:waldocs@localhost:5432/waldocs
MEMWAL_PRIVATE_KEY=
MEMWAL_ACCOUNT_ID=
MEMWAL_SERVER_URL=https://relayer-staging.memory.walrus.xyz
MEMWAL_PACKAGE_ID=0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6
MEMWAL_REGISTRY_ID=0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437
NEXT_PUBLIC_BASE_URL=http://localhost:3000
# seed script only:
OWNER_SUI_KEY=
```

- [ ] **Step 2: Create the Next.js app package**

`apps/web/package.json`:
```json
{
  "name": "web",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@prisma/client": "^6.0.0",
    "zod": "^3.23.0",
    "@mysten-incubation/memwal": "latest"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "prisma": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "paths": { "@/*": ["./src/*"] },
    "baseUrl": "."
  },
  "include": ["src", "test", "next-env.d.ts"]
}
```

`apps/web/next.config.ts`:
```ts
import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@mysten-incubation/memwal"],
};
export default config;
```

`apps/web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
```

`apps/web/src/app/layout.tsx`:
```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Write the smoke test**

`apps/web/test/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Install and run the smoke test**

Run: `pnpm install && pnpm --filter web test`
Expected: PASS (1 test passed).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm workspace + next.js app + vitest"
```

---

## Task 2: Prisma schema, client, and migration

**Files:**
- Create: `apps/web/prisma/schema.prisma`, `apps/web/src/lib/db.ts`
- Test: `apps/web/test/schema.test.ts`

**Interfaces:**
- Produces: Prisma models `Protocol`, `Application`, `ApplicationProtocol`, `Document`, `DocChunk`, `PublishEvent`; `db` singleton (`import { db } from "@/lib/db"`).

- [ ] **Step 1: Write the schema**

`apps/web/prisma/schema.prisma`:
```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model Protocol {
  id          String   @id @default(uuid())
  slug        String   @unique
  name        String
  category    String?
  description String?
  namespace   String
  tocBlobId   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  apps        ApplicationProtocol[]
}

model Application {
  id          String   @id @default(uuid())
  slug        String   @unique
  name        String
  description String?
  namespace   String
  tocBlobId   String?
  repoUrl     String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  protocols   ApplicationProtocol[]
}

model ApplicationProtocol {
  applicationId String
  protocolId    String
  application   Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  protocol      Protocol    @relation(fields: [protocolId], references: [id], onDelete: Cascade)
  @@id([applicationId, protocolId])
}

model Document {
  id         String     @id @default(uuid())
  entityType String     // "protocol" | "application"
  entityId   String
  title      String
  version    Int
  repoUrl    String?
  summary    String
  createdAt  DateTime   @default(now())
  chunks     DocChunk[]
  @@index([entityType, entityId, version])
}

model DocChunk {
  id           String   @id @default(uuid())
  documentId   String
  document     Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  ord          Int
  sectionTitle String
  contentCache String
  walrusBlobId String
  namespace    String
  createdAt    DateTime @default(now())
}

model PublishEvent {
  id         String   @id @default(uuid())
  entityType String
  entityId   String
  documentId String
  createdAt  DateTime @default(now())
  meta       Json?
}
```

- [ ] **Step 2: Create the Prisma client singleton**

`apps/web/src/lib/db.ts`:
```ts
import { PrismaClient } from "@prisma/client";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

- [ ] **Step 3: Generate client + run migration**

Run:
```bash
docker compose up -d db
cd apps/web && npx prisma migrate dev --name init
```
Expected: migration `init` applied; `@prisma/client` generated; no errors.

- [ ] **Step 4: Write a schema sanity test**

`apps/web/test/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
describe("prisma schema", () => {
  it("exposes the six models", () => {
    const models = Prisma.dmmf.datamodel.models.map((m) => m.name).sort();
    expect(models).toEqual(
      ["Application", "ApplicationProtocol", "DocChunk", "Document", "Protocol", "PublishEvent"].sort(),
    );
  });
});
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter web test schema`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add prisma schema, client, and init migration"
```

---

## Task 3: Domain types, ports, and TOC helpers

**Files:**
- Create: `apps/web/src/lib/types.ts`, `apps/web/src/lib/toc.ts`
- Test: `apps/web/test/toc.test.ts`

**Interfaces:**
- Produces:
  - `EntityType = "protocol" | "application"`
  - `PublishInput`, `PublishResult`, `EntityRef`
  - `MemwalPort { remember(text,namespace): Promise<{blobId}>; recall(query,namespace,opts?): Promise<{results:{blobId,text,distance}[]}>; ask(question,namespace): Promise<{answer,sources:{blobId,text}[]}>; health(): Promise<{status:string}> }`
  - `RepoPort` (DB methods used by publish — see code)
  - `encodeTocHeader(type,slug,name,summary): string`, `decodeTocHeader(text): {type,slug} | null`
- Consumes: nothing.

- [ ] **Step 1: Write the types/ports module**

`apps/web/src/lib/types.ts`:
```ts
export type EntityType = "protocol" | "application";

export interface EntityRef {
  type: EntityType;
  slug: string;
  name: string;
  description?: string;
  category?: string | null;
  repoUrl?: string;
}

export interface PublishInput {
  entity: EntityRef;
  summary: string;
  sections: { title: string; content: string }[];
  usesProtocols?: string[];
}

export interface PublishResult {
  url: string;
  entityType: EntityType;
  slug: string;
  documentId: string;
  version: number;
  blobIds: string[];
  tocBlobId: string;
}

export interface MemwalPort {
  remember(text: string, namespace: string): Promise<{ blobId: string }>;
  recall(
    query: string,
    namespace: string,
    opts?: { limit?: number; maxDistance?: number },
  ): Promise<{ results: { blobId: string; text: string; distance: number }[] }>;
  ask(question: string, namespace: string): Promise<{ answer: string; sources: { blobId: string; text: string }[] }>;
  health(): Promise<{ status: string }>;
}

export interface UpsertEntityArgs {
  type: EntityType;
  slug: string;
  name: string;
  description?: string;
  category?: string | null;
  namespace: string;
  repoUrl?: string;
}

export interface InsertChunkArgs {
  documentId: string;
  ord: number;
  sectionTitle: string;
  contentCache: string;
  walrusBlobId: string;
  namespace: string;
}

export interface RepoPort {
  upsertEntity(args: UpsertEntityArgs): Promise<{ id: string }>;
  nextVersion(entityType: EntityType, entityId: string): Promise<number>;
  createDocument(args: {
    entityType: EntityType;
    entityId: string;
    title: string;
    version: number;
    repoUrl?: string;
    summary: string;
  }): Promise<{ id: string }>;
  insertChunk(args: InsertChunkArgs): Promise<void>;
  setTocBlobId(type: EntityType, entityId: string, blobId: string): Promise<void>;
  linkAppProtocols(applicationId: string, protocolSlugs: string[]): Promise<void>;
  insertPublishEvent(args: {
    entityType: EntityType;
    entityId: string;
    documentId: string;
    meta?: unknown;
  }): Promise<void>;
}
```

- [ ] **Step 2: Write the failing TOC test**

`apps/web/test/toc.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { encodeTocHeader, decodeTocHeader } from "@/lib/toc";

describe("toc header", () => {
  it("encodes a parseable header line", () => {
    const line = encodeTocHeader("protocol", "walrus", "Walrus", "Decentralized storage.");
    expect(line.startsWith("[protocol:walrus] Walrus — ")).toBe(true);
  });
  it("round-trips type and slug", () => {
    const line = encodeTocHeader("application", "waldocs", "waldocs", "Docs platform.");
    expect(decodeTocHeader(line)).toEqual({ type: "application", slug: "waldocs" });
  });
  it("returns null on unparseable text", () => {
    expect(decodeTocHeader("no header here")).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter web test toc`
Expected: FAIL ("Cannot find module '@/lib/toc'").

- [ ] **Step 4: Implement the TOC helpers**

`apps/web/src/lib/toc.ts`:
```ts
import type { EntityType } from "./types";

export function encodeTocHeader(
  type: EntityType,
  slug: string,
  name: string,
  summary: string,
): string {
  return `[${type}:${slug}] ${name} — ${summary}`;
}

const HEADER_RE = /^\[(protocol|application):([a-z0-9-]+)\]/;

export function decodeTocHeader(text: string): { type: EntityType; slug: string } | null {
  const m = HEADER_RE.exec(text.trim());
  if (!m) return null;
  return { type: m[1] as EntityType, slug: m[2] };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter web test toc`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add domain types, ports, and TOC header helpers"
```

---

## Task 4: Repo layer (Prisma-backed RepoPort)

**Files:**
- Create: `apps/web/src/lib/repo.ts`
- Test: `apps/web/test/repo.test.ts` (integration — requires the local Postgres from Task 2)

**Interfaces:**
- Consumes: `db` (Task 2), `RepoPort` + arg types (Task 3).
- Produces: `repo: RepoPort` (default export object) backed by Prisma.

- [ ] **Step 1: Write the failing integration test**

`apps/web/test/repo.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { repo } from "@/lib/repo";
import { db } from "@/lib/db";

beforeEach(async () => {
  await db.docChunk.deleteMany();
  await db.document.deleteMany();
  await db.applicationProtocol.deleteMany();
  await db.application.deleteMany();
  await db.protocol.deleteMany();
  await db.publishEvent.deleteMany();
});

describe("repo", () => {
  it("upserts an entity idempotently by slug", async () => {
    const a = await repo.upsertEntity({ type: "protocol", slug: "walrus", name: "Walrus", namespace: "proto.walrus" });
    const b = await repo.upsertEntity({ type: "protocol", slug: "walrus", name: "Walrus 2", namespace: "proto.walrus" });
    expect(a.id).toBe(b.id);
    const row = await db.protocol.findUnique({ where: { slug: "walrus" } });
    expect(row?.name).toBe("Walrus 2");
  });

  it("increments version per entity", async () => {
    const e = await repo.upsertEntity({ type: "application", slug: "waldocs", name: "waldocs", namespace: "app.waldocs" });
    expect(await repo.nextVersion("application", e.id)).toBe(1);
    await repo.createDocument({ entityType: "application", entityId: e.id, title: "t", version: 1, summary: "s" });
    expect(await repo.nextVersion("application", e.id)).toBe(2);
  });

  it("auto-creates stub protocols when linking", async () => {
    const app = await repo.upsertEntity({ type: "application", slug: "waldocs", name: "waldocs", namespace: "app.waldocs" });
    await repo.linkAppProtocols(app.id, ["walrus", "sui"]);
    const protos = await db.protocol.findMany();
    expect(protos.map((p) => p.slug).sort()).toEqual(["sui", "walrus"]);
    const links = await db.applicationProtocol.findMany();
    expect(links).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker compose up -d db && pnpm --filter web test repo`
Expected: FAIL ("Cannot find module '@/lib/repo'").

- [ ] **Step 3: Implement the repo**

`apps/web/src/lib/repo.ts`:
```ts
import { db } from "./db";
import type { EntityType, RepoPort, UpsertEntityArgs, InsertChunkArgs } from "./types";

async function upsertEntity(args: UpsertEntityArgs): Promise<{ id: string }> {
  const data = {
    name: args.name,
    description: args.description ?? null,
    namespace: args.namespace,
  };
  if (args.type === "protocol") {
    const row = await db.protocol.upsert({
      where: { slug: args.slug },
      create: { slug: args.slug, category: args.category ?? null, ...data },
      update: { category: args.category ?? null, ...data },
    });
    return { id: row.id };
  }
  const row = await db.application.upsert({
    where: { slug: args.slug },
    create: { slug: args.slug, repoUrl: args.repoUrl ?? null, ...data },
    update: { repoUrl: args.repoUrl ?? null, ...data },
  });
  return { id: row.id };
}

async function nextVersion(_entityType: EntityType, entityId: string): Promise<number> {
  const last = await db.document.findFirst({
    where: { entityId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (last?.version ?? 0) + 1;
}

async function createDocument(args: {
  entityType: EntityType;
  entityId: string;
  title: string;
  version: number;
  repoUrl?: string;
  summary: string;
}): Promise<{ id: string }> {
  const row = await db.document.create({
    data: {
      entityType: args.entityType,
      entityId: args.entityId,
      title: args.title,
      version: args.version,
      repoUrl: args.repoUrl ?? null,
      summary: args.summary,
    },
  });
  return { id: row.id };
}

async function insertChunk(args: InsertChunkArgs): Promise<void> {
  await db.docChunk.create({ data: args });
}

async function setTocBlobId(type: EntityType, entityId: string, blobId: string): Promise<void> {
  if (type === "protocol") await db.protocol.update({ where: { id: entityId }, data: { tocBlobId: blobId } });
  else await db.application.update({ where: { id: entityId }, data: { tocBlobId: blobId } });
}

async function linkAppProtocols(applicationId: string, protocolSlugs: string[]): Promise<void> {
  for (const slug of protocolSlugs) {
    const proto = await db.protocol.upsert({
      where: { slug },
      create: { slug, name: slug, namespace: `proto.${slug}` },
      update: {},
    });
    await db.applicationProtocol.upsert({
      where: { applicationId_protocolId: { applicationId, protocolId: proto.id } },
      create: { applicationId, protocolId: proto.id },
      update: {},
    });
  }
}

async function insertPublishEvent(args: {
  entityType: EntityType;
  entityId: string;
  documentId: string;
  meta?: unknown;
}): Promise<void> {
  await db.publishEvent.create({
    data: {
      entityType: args.entityType,
      entityId: args.entityId,
      documentId: args.documentId,
      meta: (args.meta ?? undefined) as object | undefined,
    },
  });
}

export const repo: RepoPort = {
  upsertEntity,
  nextVersion,
  createDocument,
  insertChunk,
  setTocBlobId,
  linkAppProtocols,
  insertPublishEvent,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web test repo`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Prisma-backed repo layer"
```

---

## Task 5: MemWal wrapper (MemwalPort)

**Files:**
- Create: `apps/web/src/lib/memwal.ts`
- Test: `apps/web/test/memwal.test.ts`

**Interfaces:**
- Consumes: `MemwalPort` (Task 3), `@mysten-incubation/memwal`.
- Produces: `memwal: MemwalPort` singleton; `createMemwal(client): MemwalPort` factory (for tests/injection).

- [ ] **Step 1: Write the failing test (factory over a fake SDK client)**

`apps/web/test/memwal.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createMemwal } from "@/lib/memwal";

function fakeClient() {
  return {
    rememberAndWait: vi.fn(async (_t: string, _ns: string) => ({ blob_id: "blob-1" })),
    recall: vi.fn(async (_p: { query: string; namespace: string }) => ({
      results: [{ blob_id: "b", text: "[protocol:walrus] Walrus — x", distance: 0.2 }],
      total: 1,
    })),
    ask: vi.fn(async (_q: string, _ns: string) => ({ answer: "yes", sources: [{ blob_id: "b", text: "t" }] })),
    health: vi.fn(async () => ({ status: "ok", version: "1" })),
  };
}

describe("memwal wrapper", () => {
  it("maps remember to blobId", async () => {
    const m = createMemwal(fakeClient() as never);
    expect(await m.remember("hi", "proto.walrus")).toEqual({ blobId: "blob-1" });
  });
  it("maps recall results to camelCase", async () => {
    const m = createMemwal(fakeClient() as never);
    const r = await m.recall("q", "_toc", { maxDistance: 0.7 });
    expect(r.results[0]).toEqual({ blobId: "b", text: "[protocol:walrus] Walrus — x", distance: 0.2 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test memwal`
Expected: FAIL ("Cannot find module '@/lib/memwal'").

- [ ] **Step 3: Implement the wrapper**

`apps/web/src/lib/memwal.ts`:
```ts
import "server-only";
import { MemWal } from "@mysten-incubation/memwal";
import type { MemwalPort } from "./types";

const REMEMBER_TIMEOUT_MS = 60_000;

// Minimal shape of the SDK client we rely on (keeps us decoupled from beta churn).
interface SdkClient {
  rememberAndWait(text: string, namespace?: string, opts?: { timeoutMs?: number }): Promise<{ blob_id: string }>;
  recall(params: { query: string; namespace?: string; limit?: number; maxDistance?: number }): Promise<{
    results: { blob_id: string; text: string; distance: number }[];
    total: number;
  }>;
  ask(question: string, namespace?: string): Promise<{ answer: string; sources?: { blob_id: string; text: string }[] }>;
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
    async ask(question, namespace) {
      const r = await client.ask(question, namespace);
      return { answer: r.answer, sources: (r.sources ?? []).map((s) => ({ blobId: s.blob_id, text: s.text })) };
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
```

> Note: `ask` maps to the relayer `/api/ask` flow (guide §13.10). If the installed SDK exposes `ask` under a different name, adapt only inside `SdkClient`/`buildClient` — the port stays stable.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web test memwal`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add MemWal SDK wrapper behind MemwalPort"
```

---

## Task 6: Publish service (core pipeline)

**Files:**
- Create: `apps/web/src/lib/publish.ts`
- Test: `apps/web/test/publish.test.ts`

**Interfaces:**
- Consumes: `PublishInput`, `PublishResult`, `MemwalPort`, `RepoPort` (Task 3); `encodeTocHeader` (Task 3).
- Produces: `publishDocument(input: PublishInput, deps: { repo: RepoPort; memwal: MemwalPort; baseUrl: string }): Promise<PublishResult>`; `namespaceFor(type, slug): string`.

- [ ] **Step 1: Write the failing test with in-memory fakes**

`apps/web/test/publish.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { publishDocument, namespaceFor } from "@/lib/publish";
import type { MemwalPort, RepoPort, PublishInput } from "@/lib/types";

function fakes() {
  const calls = { remembered: [] as { text: string; ns: string }[], links: [] as string[], toc: [] as string[] };
  let blob = 0;
  const memwal: MemwalPort = {
    async remember(text, ns) { calls.remembered.push({ text, ns }); return { blobId: `blob-${++blob}` }; },
    async recall() { return { results: [] }; },
    async ask() { return { answer: "", sources: [] }; },
    async health() { return { status: "ok" }; },
  };
  const repo: RepoPort = {
    async upsertEntity() { return { id: "entity-1" }; },
    async nextVersion() { return 1; },
    async createDocument() { return { id: "doc-1" }; },
    async insertChunk(a) { calls.toc.push(a.walrusBlobId); },
    async setTocBlobId() {},
    async linkAppProtocols(_id, slugs) { calls.links.push(...slugs); },
    async insertPublishEvent() {},
  };
  return { memwal, repo, calls };
}

const input: PublishInput = {
  entity: { type: "application", slug: "waldocs", name: "waldocs", repoUrl: "https://x" },
  summary: "Docs platform.",
  sections: [
    { title: "Overview", content: "It does docs." },
    { title: "Install", content: "pnpm add." },
  ],
  usesProtocols: ["walrus", "sui"],
};

describe("publishDocument", () => {
  it("computes namespaces", () => {
    expect(namespaceFor("protocol", "walrus")).toBe("proto.walrus");
    expect(namespaceFor("application", "waldocs")).toBe("app.waldocs");
  });

  it("writes one memory per section into the entity namespace, then the TOC", async () => {
    const { memwal, repo, calls } = fakes();
    const res = await publishDocument(input, { repo, memwal, baseUrl: "http://h" });
    // 2 section writes + 1 TOC write
    expect(calls.remembered.map((c) => c.ns)).toEqual(["app.waldocs", "app.waldocs", "_toc"]);
    expect(calls.remembered[2].text.startsWith("[application:waldocs]")).toBe(true);
    expect(res.blobIds).toEqual(["blob-1", "blob-2"]);
    expect(res.tocBlobId).toBe("blob-3");
    expect(res.url).toBe("http://h/app/waldocs");
    expect(res.version).toBe(1);
  });

  it("links app protocols", async () => {
    const { memwal, repo, calls } = fakes();
    await publishDocument(input, { repo, memwal, baseUrl: "http://h" });
    expect(calls.links.sort()).toEqual(["sui", "walrus"]);
  });

  it("rejects empty sections", async () => {
    const { memwal, repo } = fakes();
    await expect(
      publishDocument({ ...input, sections: [] }, { repo, memwal, baseUrl: "http://h" }),
    ).rejects.toThrow(/at least one section/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test publish`
Expected: FAIL ("Cannot find module '@/lib/publish'").

- [ ] **Step 3: Implement the publish service**

`apps/web/src/lib/publish.ts`:
```ts
import type { EntityType, MemwalPort, PublishInput, PublishResult, RepoPort } from "./types";
import { encodeTocHeader } from "./toc";

export function namespaceFor(type: EntityType, slug: string): string {
  return type === "protocol" ? `proto.${slug}` : `app.${slug}`;
}

export async function publishDocument(
  input: PublishInput,
  deps: { repo: RepoPort; memwal: MemwalPort; baseUrl: string },
): Promise<PublishResult> {
  const { repo, memwal, baseUrl } = deps;
  const { entity, sections, summary } = input;

  if (!sections || sections.length === 0) {
    throw new Error("Publish requires at least one section.");
  }

  const namespace = namespaceFor(entity.type, entity.slug);
  const { id: entityId } = await repo.upsertEntity({
    type: entity.type,
    slug: entity.slug,
    name: entity.name,
    description: entity.description,
    category: entity.category,
    namespace,
    repoUrl: entity.repoUrl,
  });

  const version = await repo.nextVersion(entity.type, entityId);
  const { id: documentId } = await repo.createDocument({
    entityType: entity.type,
    entityId,
    title: entity.name,
    version,
    repoUrl: entity.repoUrl,
    summary,
  });

  const blobIds: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const { blobId } = await memwal.remember(s.content, namespace);
    await repo.insertChunk({
      documentId,
      ord: i,
      sectionTitle: s.title,
      contentCache: s.content,
      walrusBlobId: blobId,
      namespace,
    });
    blobIds.push(blobId);
  }

  const tocLine = encodeTocHeader(entity.type, entity.slug, entity.name, summary);
  const { blobId: tocBlobId } = await memwal.remember(tocLine, "_toc");
  await repo.setTocBlobId(entity.type, entityId, tocBlobId);

  if (entity.type === "application" && input.usesProtocols?.length) {
    await repo.linkAppProtocols(entityId, input.usesProtocols);
  }

  await repo.insertPublishEvent({
    entityType: entity.type,
    entityId,
    documentId,
    meta: { repoUrl: entity.repoUrl, chunkCount: sections.length },
  });

  const path = entity.type === "protocol" ? `/protocol/${entity.slug}` : `/app/${entity.slug}`;
  return { url: `${baseUrl}${path}`, entityType: entity.type, slug: entity.slug, documentId, version, blobIds, tocBlobId };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web test publish`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add publish pipeline service with injected ports"
```

---

## Task 7: `POST /api/publish` route + payload validation

**Files:**
- Create: `apps/web/src/lib/validation.ts`, `apps/web/src/app/api/publish/route.ts`
- Test: `apps/web/test/publish-route.test.ts`

**Interfaces:**
- Consumes: `publishDocument` (Task 6), `repo` (Task 4), `getMemwal` (Task 5).
- Produces: `publishSchema` (zod), `POST` handler returning the `PublishResult` JSON (Task 3 contract).

- [ ] **Step 1: Write the failing route test (mock repo + memwal modules)**

`apps/web/test/publish-route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/repo", () => {
  let v = 0;
  return {
    repo: {
      upsertEntity: vi.fn(async () => ({ id: "e1" })),
      nextVersion: vi.fn(async () => ++v),
      createDocument: vi.fn(async () => ({ id: "d1" })),
      insertChunk: vi.fn(async () => {}),
      setTocBlobId: vi.fn(async () => {}),
      linkAppProtocols: vi.fn(async () => {}),
      insertPublishEvent: vi.fn(async () => {}),
    },
  };
});

let blob = 0;
vi.mock("@/lib/memwal", () => ({
  getMemwal: () => ({
    remember: vi.fn(async () => ({ blobId: `b${++blob}` })),
    recall: vi.fn(), ask: vi.fn(), health: vi.fn(),
  }),
}));

beforeEach(() => { blob = 0; });

async function call(body: unknown) {
  const { POST } = await import("@/app/api/publish/route");
  const req = new Request("http://h/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/publish", () => {
  it("400s on invalid payload", async () => {
    const res = await call({ entity: { type: "protocol" } });
    expect(res.status).toBe(400);
  });

  it("publishes and returns the contract", async () => {
    const res = await call({
      entity: { type: "protocol", slug: "walrus", name: "Walrus" },
      summary: "Storage.",
      sections: [{ title: "Overview", content: "x" }],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slug).toBe("walrus");
    expect(json.blobIds).toEqual(["b1"]);
    expect(json.url).toContain("/protocol/walrus");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test publish-route`
Expected: FAIL ("Cannot find module '@/app/api/publish/route'").

- [ ] **Step 3: Implement the validation schema**

`apps/web/src/lib/validation.ts`:
```ts
import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric/hyphen");

export const publishSchema = z.object({
  entity: z.object({
    type: z.enum(["protocol", "application"]),
    slug,
    name: z.string().min(1),
    description: z.string().optional(),
    category: z.string().nullish(),
    repoUrl: z.string().url().optional(),
  }),
  summary: z.string().min(1),
  sections: z.array(z.object({ title: z.string().min(1), content: z.string().min(1) })).min(1),
  usesProtocols: z.array(slug).optional(),
});

export type PublishBody = z.infer<typeof publishSchema>;
```

- [ ] **Step 4: Implement the route**

`apps/web/src/app/api/publish/route.ts`:
```ts
import { NextResponse } from "next/server";
import { publishSchema } from "@/lib/validation";
import { publishDocument } from "@/lib/publish";
import { repo } from "@/lib/repo";
import { getMemwal } from "@/lib/memwal";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
  try {
    const result = await publishDocument(parsed.data, { repo, memwal: getMemwal(), baseUrl });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter web test publish-route`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add POST /api/publish route with zod validation"
```

---

## Task 8: List + detail read routes

**Files:**
- Create: `apps/web/src/app/api/protocols/route.ts`, `apps/web/src/app/api/protocols/[slug]/route.ts`, `apps/web/src/app/api/applications/route.ts`, `apps/web/src/app/api/applications/[slug]/route.ts`
- Create: `apps/web/src/lib/queries.ts`
- Test: `apps/web/test/queries.test.ts` (integration — local Postgres)

**Interfaces:**
- Consumes: `db` (Task 2), `publishDocument` (to seed test data via repo is heavier — tests seed via `db` directly).
- Produces: `listEntities(type)`, `getEntityDetail(type, slug)` in `queries.ts`; four route handlers.

- [ ] **Step 1: Write the failing test**

`apps/web/test/queries.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { listEntities, getEntityDetail } from "@/lib/queries";

beforeEach(async () => {
  await db.docChunk.deleteMany();
  await db.document.deleteMany();
  await db.applicationProtocol.deleteMany();
  await db.application.deleteMany();
  await db.protocol.deleteMany();
});

describe("queries", () => {
  it("lists protocols", async () => {
    await db.protocol.create({ data: { slug: "walrus", name: "Walrus", namespace: "proto.walrus" } });
    const rows = await listEntities("protocol");
    expect(rows.map((r) => r.slug)).toEqual(["walrus"]);
  });

  it("returns latest-version chunks in order for detail", async () => {
    const app = await db.application.create({ data: { slug: "waldocs", name: "waldocs", namespace: "app.waldocs" } });
    const d1 = await db.document.create({ data: { entityType: "application", entityId: app.id, title: "waldocs", version: 1, summary: "s" } });
    const d2 = await db.document.create({ data: { entityType: "application", entityId: app.id, title: "waldocs", version: 2, summary: "s2" } });
    await db.docChunk.create({ data: { documentId: d1.id, ord: 0, sectionTitle: "Old", contentCache: "old", walrusBlobId: "x", namespace: "app.waldocs" } });
    await db.docChunk.create({ data: { documentId: d2.id, ord: 1, sectionTitle: "B", contentCache: "b", walrusBlobId: "y", namespace: "app.waldocs" } });
    await db.docChunk.create({ data: { documentId: d2.id, ord: 0, sectionTitle: "A", contentCache: "a", walrusBlobId: "z", namespace: "app.waldocs" } });

    const detail = await getEntityDetail("application", "waldocs");
    expect(detail?.version).toBe(2);
    expect(detail?.chunks.map((c) => c.sectionTitle)).toEqual(["A", "B"]);
  });

  it("returns null for unknown slug", async () => {
    expect(await getEntityDetail("protocol", "nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test queries`
Expected: FAIL ("Cannot find module '@/lib/queries'").

- [ ] **Step 3: Implement queries**

`apps/web/src/lib/queries.ts`:
```ts
import { db } from "./db";
import type { EntityType } from "./types";

export async function listEntities(type: EntityType) {
  if (type === "protocol") {
    return db.protocol.findMany({ orderBy: { name: "asc" } });
  }
  return db.application.findMany({ orderBy: { name: "asc" } });
}

export async function getEntityDetail(type: EntityType, slug: string) {
  const entity =
    type === "protocol"
      ? await db.protocol.findUnique({ where: { slug } })
      : await db.application.findUnique({ where: { slug } });
  if (!entity) return null;

  const latest = await db.document.findFirst({
    where: { entityId: entity.id },
    orderBy: { version: "desc" },
  });

  const chunks = latest
    ? await db.docChunk.findMany({ where: { documentId: latest.id }, orderBy: { ord: "asc" } })
    : [];

  let protocols: { slug: string; name: string }[] = [];
  if (type === "application") {
    const links = await db.applicationProtocol.findMany({
      where: { applicationId: entity.id },
      include: { protocol: true },
    });
    protocols = links.map((l) => ({ slug: l.protocol.slug, name: l.protocol.name }));
  }

  return {
    type,
    slug: entity.slug,
    name: entity.name,
    description: entity.description,
    version: latest?.version ?? null,
    summary: latest?.summary ?? null,
    chunks: chunks.map((c) => ({ sectionTitle: c.sectionTitle, content: c.contentCache, blobId: c.walrusBlobId })),
    protocols,
  };
}
```

- [ ] **Step 4: Implement the four routes**

`apps/web/src/app/api/protocols/route.ts`:
```ts
import { NextResponse } from "next/server";
import { listEntities } from "@/lib/queries";
export async function GET() {
  return NextResponse.json(await listEntities("protocol"));
}
```

`apps/web/src/app/api/applications/route.ts`:
```ts
import { NextResponse } from "next/server";
import { listEntities } from "@/lib/queries";
export async function GET() {
  return NextResponse.json(await listEntities("application"));
}
```

`apps/web/src/app/api/protocols/[slug]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getEntityDetail } from "@/lib/queries";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const detail = await getEntityDetail("protocol", slug);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}
```

`apps/web/src/app/api/applications/[slug]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getEntityDetail } from "@/lib/queries";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const detail = await getEntityDetail("application", slug);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter web test queries`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add list + detail read queries and routes"
```

---

## Task 9: `POST /api/search` (discovery over `_toc`)

**Files:**
- Create: `apps/web/src/lib/search.ts`, `apps/web/src/app/api/search/route.ts`
- Test: `apps/web/test/search.test.ts`

**Interfaces:**
- Consumes: `MemwalPort` (Task 3), `decodeTocHeader` (Task 3), `db` (Task 2).
- Produces: `searchToc(query, { memwal, db }): Promise<{ type, slug, name, summary, distance }[]>`; `POST` handler.

- [ ] **Step 1: Write the failing test**

`apps/web/test/search.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { searchToc } from "@/lib/search";
import type { MemwalPort } from "@/lib/types";

const memwal: MemwalPort = {
  async remember() { return { blobId: "x" }; },
  async recall() {
    return {
      results: [
        { blobId: "1", text: "[protocol:walrus] Walrus — storage", distance: 0.1 },
        { blobId: "2", text: "garbage no header", distance: 0.2 },
        { blobId: "3", text: "[application:waldocs] waldocs — docs", distance: 0.3 },
      ],
    };
  },
  async ask() { return { answer: "", sources: [] }; },
  async health() { return { status: "ok" }; },
};

const fakeDb = {
  protocol: { findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => ({ slug: where.slug, name: "Walrus", description: "d" })) },
  application: { findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => ({ slug: where.slug, name: "waldocs", description: "d" })) },
};

describe("searchToc", () => {
  it("drops headerless results and resolves entities", async () => {
    const out = await searchToc("store files", { memwal, db: fakeDb as never });
    expect(out.map((o) => o.slug)).toEqual(["walrus", "waldocs"]);
    expect(out[0]).toMatchObject({ type: "protocol", name: "Walrus", distance: 0.1 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test search`
Expected: FAIL ("Cannot find module '@/lib/search'").

- [ ] **Step 3: Implement search**

`apps/web/src/lib/search.ts`:
```ts
import type { MemwalPort, EntityType } from "./types";
import { decodeTocHeader } from "./toc";

type DbLike = {
  protocol: { findUnique(args: { where: { slug: string } }): Promise<{ slug: string; name: string; description: string | null } | null> };
  application: { findUnique(args: { where: { slug: string } }): Promise<{ slug: string; name: string; description: string | null } | null> };
};

export interface SearchHit {
  type: EntityType;
  slug: string;
  name: string;
  summary: string | null;
  distance: number;
}

export async function searchToc(
  query: string,
  deps: { memwal: MemwalPort; db: DbLike },
): Promise<SearchHit[]> {
  const { results } = await deps.memwal.recall(query, "_toc", { limit: 10, maxDistance: 0.7 });
  const hits: SearchHit[] = [];
  for (const r of results) {
    const decoded = decodeTocHeader(r.text);
    if (!decoded) continue;
    const row =
      decoded.type === "protocol"
        ? await deps.db.protocol.findUnique({ where: { slug: decoded.slug } })
        : await deps.db.application.findUnique({ where: { slug: decoded.slug } });
    if (!row) continue;
    hits.push({ type: decoded.type, slug: row.slug, name: row.name, summary: row.description, distance: r.distance });
  }
  return hits;
}
```

- [ ] **Step 4: Implement the route**

`apps/web/src/app/api/search/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { searchToc } from "@/lib/search";
import { getMemwal } from "@/lib/memwal";
import { db } from "@/lib/db";

const schema = z.object({ query: z.string().min(1) });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const hits = await searchToc(parsed.data.query, { memwal: getMemwal(), db });
  return NextResponse.json({ results: hits });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter web test search`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add /api/search discovery over the _toc namespace"
```

---

## Task 10: `POST /api/ask` + `GET /api/healthz`

**Files:**
- Create: `apps/web/src/app/api/ask/route.ts`, `apps/web/src/app/api/healthz/route.ts`
- Test: `apps/web/test/ask-route.test.ts`

**Interfaces:**
- Consumes: `getMemwal` (Task 5), `namespaceFor` (Task 6), `db` (Task 2).
- Produces: `POST /api/ask` returning `{ answer, sources }`; `GET /api/healthz` returning `{ ok, relayer, db }`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/ask-route.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/memwal", () => ({
  getMemwal: () => ({
    ask: vi.fn(async (q: string, ns: string) => ({ answer: `A:${q}@${ns}`, sources: [{ blobId: "b", text: "t" }] })),
    remember: vi.fn(), recall: vi.fn(), health: vi.fn(),
  }),
}));

async function call(body: unknown) {
  const { POST } = await import("@/app/api/ask/route");
  return POST(new Request("http://h/api/ask", { method: "POST", body: JSON.stringify(body) }));
}

describe("POST /api/ask", () => {
  it("400s without question", async () => {
    expect((await call({ entityType: "protocol", slug: "walrus" })).status).toBe(400);
  });
  it("scopes the question to the entity namespace", async () => {
    const res = await call({ entityType: "protocol", slug: "walrus", question: "what is it?" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.answer).toBe("A:what is it?@proto.walrus");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test ask-route`
Expected: FAIL ("Cannot find module '@/app/api/ask/route'").

- [ ] **Step 3: Implement the ask route**

`apps/web/src/app/api/ask/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getMemwal } from "@/lib/memwal";
import { namespaceFor } from "@/lib/publish";

const schema = z.object({
  entityType: z.enum(["protocol", "application"]),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  question: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const ns = namespaceFor(parsed.data.entityType, parsed.data.slug);
  const { answer, sources } = await getMemwal().ask(parsed.data.question, ns);
  return NextResponse.json({ answer, sources });
}
```

- [ ] **Step 4: Implement the healthz route**

`apps/web/src/app/api/healthz/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getMemwal } from "@/lib/memwal";
import { db } from "@/lib/db";

export async function GET() {
  const out = { ok: true, relayer: "unknown", db: "unknown" as string };
  try {
    out.relayer = (await getMemwal().health()).status;
  } catch {
    out.relayer = "down";
    out.ok = false;
  }
  try {
    await db.$queryRaw`SELECT 1`;
    out.db = "up";
  } catch {
    out.db = "down";
    out.ok = false;
  }
  return NextResponse.json(out, { status: out.ok ? 200 : 503 });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter web test ask-route`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add /api/ask and /api/healthz routes"
```

---

## Task 11: Browse UI (home + entity pages + AskBox)

**Files:**
- Create: `apps/web/src/app/page.tsx`, `apps/web/src/app/protocol/[slug]/page.tsx`, `apps/web/src/app/app/[slug]/page.tsx`, `apps/web/src/app/_components/AskBox.tsx`
- Modify: `apps/web/src/lib/queries.ts` (no change needed — reuse)

**Interfaces:**
- Consumes: `listEntities`, `getEntityDetail` (Task 8); `/api/search`, `/api/ask`.
- Produces: rendered pages. Verification is build + manual run (UI is not unit-tested in v1).

- [ ] **Step 1: Implement the home page (server component)**

`apps/web/src/app/page.tsx`:
```tsx
import Link from "next/link";
import { listEntities } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [protocols, applications] = await Promise.all([listEntities("protocol"), listEntities("application")]);
  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>waldocs</h1>
      <p>Unified dev docs on Walrus Memory.</p>
      <form action="/search" method="get">
        <input name="q" placeholder="Search docs…" style={{ width: "100%", padding: 8 }} />
      </form>
      <section>
        <h2>Protocols</h2>
        <ul>
          {protocols.map((p) => (
            <li key={p.slug}><Link href={`/protocol/${p.slug}`}>{p.name}</Link></li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Applications</h2>
        <ul>
          {applications.map((a) => (
            <li key={a.slug}><Link href={`/app/${a.slug}`}>{a.name}</Link></li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Implement the AskBox client component**

`apps/web/src/app/_components/AskBox.tsx`:
```tsx
"use client";
import { useState } from "react";

export function AskBox({ entityType, slug }: { entityType: "protocol" | "application"; slug: string }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask() {
    setLoading(true);
    setAnswer(null);
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType, slug, question: q }),
    });
    const json = await res.json();
    setAnswer(res.ok ? json.answer : `Error: ${json.error ?? "failed"}`);
    setLoading(false);
  }

  return (
    <div style={{ marginTop: 24, padding: 12, border: "1px solid #ddd" }}>
      <strong>Ask these docs</strong>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question…" style={{ flex: 1, padding: 6 }} />
        <button onClick={ask} disabled={loading || !q}>{loading ? "…" : "Ask"}</button>
      </div>
      {answer && <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{answer}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Implement the entity detail pages**

`apps/web/src/app/protocol/[slug]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getEntityDetail } from "@/lib/queries";
import { AskBox } from "@/app/_components/AskBox";

export const dynamic = "force-dynamic";

export default async function ProtocolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await getEntityDetail("protocol", slug);
  if (!d) notFound();
  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui" }}>
      <Link href="/">← waldocs</Link>
      <h1>{d.name} <small>(protocol)</small></h1>
      {d.chunks.map((c) => (
        <section key={c.sectionTitle}>
          <h2>{c.sectionTitle}</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{c.content}</p>
        </section>
      ))}
      <AskBox entityType="protocol" slug={slug} />
    </main>
  );
}
```

`apps/web/src/app/app/[slug]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getEntityDetail } from "@/lib/queries";
import { AskBox } from "@/app/_components/AskBox";

export const dynamic = "force-dynamic";

export default async function AppPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await getEntityDetail("application", slug);
  if (!d) notFound();
  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui" }}>
      <Link href="/">← waldocs</Link>
      <h1>{d.name} <small>(application)</small></h1>
      {d.protocols.length > 0 && (
        <p>Uses: {d.protocols.map((p) => <Link key={p.slug} href={`/protocol/${p.slug}`} style={{ marginRight: 8 }}>{p.name}</Link>)}</p>
      )}
      {d.chunks.map((c) => (
        <section key={c.sectionTitle}>
          <h2>{c.sectionTitle}</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{c.content}</p>
        </section>
      ))}
      <AskBox entityType="application" slug={slug} />
    </main>
  );
}
```

- [ ] **Step 4: Verify the build**

Run: `pnpm --filter web build`
Expected: build succeeds (all routes + pages compile, no type errors).

- [ ] **Step 5: Manual smoke (optional, needs seeded data + env)**

Run: `pnpm --filter web dev`, open `http://localhost:3000`, confirm the home page lists entities and a detail page renders.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add browse UI (home, entity pages, ask box)"
```

---

## Task 12: One-time MemWal account bootstrap script

**Files:**
- Create: `scripts/seed-account.ts`

**Interfaces:**
- Consumes: `@mysten-incubation/memwal/account`.
- Produces: prints `MEMWAL_PRIVATE_KEY` + `MEMWAL_ACCOUNT_ID` to paste into `.env`.

- [ ] **Step 1: Implement the script**

`scripts/seed-account.ts`:
```ts
/**
 * One-time bootstrap: creates the backend's MemWalAccount on TESTNET and a
 * delegate key. Requires OWNER_SUI_KEY (bech32 suiprivkey1...) funded with
 * testnet SUI (https://faucet.sui.io/). Run: pnpm seed:account
 */
import { generateDelegateKey, createAccount, addDelegateKey } from "@mysten-incubation/memwal/account";

const MEMWAL_PACKAGE_ID = process.env.MEMWAL_PACKAGE_ID ?? "0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6";
const MEMWAL_REGISTRY_ID = process.env.MEMWAL_REGISTRY_ID ?? "0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437";

async function main() {
  const ownerKey = process.env.OWNER_SUI_KEY;
  if (!ownerKey) throw new Error("Set OWNER_SUI_KEY (bech32 suiprivkey1...) funded with testnet SUI.");

  const delegate = await generateDelegateKey();
  const account = await createAccount({
    packageId: MEMWAL_PACKAGE_ID,
    registryId: MEMWAL_REGISTRY_ID,
    suiPrivateKey: ownerKey,
    suiNetwork: "testnet",
  });
  await addDelegateKey({
    packageId: MEMWAL_PACKAGE_ID,
    accountId: account.accountId,
    publicKey: delegate.publicKey,
    label: "waldocs-backend",
    suiPrivateKey: ownerKey,
    suiNetwork: "testnet",
  });

  console.log("\n# Paste into apps/web/.env :");
  console.log(`MEMWAL_PRIVATE_KEY=${delegate.privateKey}`);
  console.log(`MEMWAL_ACCOUNT_ID=${account.accountId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it type-checks / runs to the guard**

Run: `npx tsx scripts/seed-account.ts`
Expected: exits with the error "Set OWNER_SUI_KEY…" when the env var is absent (confirms it loads and reaches the guard). With a funded `OWNER_SUI_KEY`, it prints the two env lines.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add one-time testnet MemWal account bootstrap script"
```

---

## Task 13: Claude Code plugin (`/waldocs-publish`)

**Files:**
- Create: `packages/plugin/plugin.json`, `packages/plugin/commands/waldocs-publish.md`

**Interfaces:**
- Consumes: the backend `POST /api/publish` contract (Task 7).
- Produces: a slash command that synthesizes a doc from the repo and publishes it.

- [ ] **Step 1: Implement the plugin manifest**

`packages/plugin/plugin.json`:
```json
{
  "name": "waldocs",
  "version": "0.1.0",
  "description": "Publish repo-generated dev docs to the waldocs platform (Walrus Memory).",
  "commands": ["./commands/waldocs-publish.md"]
}
```

- [ ] **Step 2: Implement the slash command**

`packages/plugin/commands/waldocs-publish.md`:
````markdown
---
description: Synthesize a dev-doc from this repo and publish it to waldocs
argument-hint: "[--as protocol|application] [--slug <slug>] [--name <name>]"
---

You are publishing this repository's documentation to **waldocs**.

## Configuration
- Backend base URL: `${WALDOCS_API_URL:-http://localhost:3000}`
- Publish endpoint: `POST {base}/api/publish`

## Steps

1. **Determine the entity.** Parse `$ARGUMENTS` for `--as`, `--slug`, `--name`.
   - If `--as` is missing, infer: a reusable library / infrastructure / SDK → `protocol`; a project that *uses* other protocols → `application`. State your inference and ask the user to confirm or correct before publishing.
   - Derive `slug` (lowercase, hyphenated) from the repo name if not provided.

2. **Gather context.** Read `README*`, package manifests (`package.json`, `Cargo.toml`, `Move.toml`, `pyproject.toml`), and the most important source files. Use what's already in this session.

3. **Synthesize the doc** as ordered sections. Recommended sections: `Overview`, `Install`, `Usage`, `API`, `Examples`, `Notes`. Each section: a `title` and clear markdown `content`. Also write a 1–3 sentence `summary`.

4. **For applications**, determine `usesProtocols`: the slugs of protocols this project integrates (e.g. `["walrus","sui"]`). Use lowercase hyphenated slugs.

5. **Publish.** POST this exact JSON shape to the endpoint:

```json
{
  "entity": { "type": "<protocol|application>", "slug": "<slug>", "name": "<name>", "description": "<one line>", "repoUrl": "<url or omit>" },
  "summary": "<1-3 sentences>",
  "sections": [ { "title": "Overview", "content": "<markdown>" } ],
  "usesProtocols": ["<slug>"]
}
```

Run it with curl:

```bash
curl -sS -X POST "${WALDOCS_API_URL:-http://localhost:3000}/api/publish" \
  -H "content-type: application/json" \
  -d @- <<'JSON'
{ ...the payload above... }
JSON
```

6. **Report.** On success the response includes `url`, `version`, and `blobIds`. Show the user the `url` and how many sections (blobs) were published. On a 400, show the validation `issues` and fix the payload.
````

- [ ] **Step 3: Verify the manifest is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('packages/plugin/plugin.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Manual end-to-end (optional, needs running backend)**

With the backend running and seeded env, in a sample repo run `/waldocs-publish --as application --slug demo --name Demo`, then confirm the entity appears at `/app/demo`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add /waldocs-publish Claude Code plugin"
```

---

## Self-Review

**Spec coverage:**
- Two indexes (protocols/applications) + M:N links → Tasks 2, 4, 8. ✓
- Namespace-per-entity + `_toc` → Tasks 3, 6. ✓
- Section chunking + Walrus write + Postgres cache → Task 6. ✓
- Publish contract (§6.2) → Tasks 6, 7. ✓
- APIs (publish/list/detail/search/ask/healthz) → Tasks 7–10. ✓
- Browse UI → Task 11. ✓
- Key mgmt / seed script (testnet) → Tasks 5, 12. ✓
- Plugin (Claude generates from repo) → Task 13. ✓
- Testing strategy → unit tests in Tasks 3,5,6,7,9,10; integration in Tasks 4,8; build/manual in 11–13. ✓

**Type consistency:** `MemwalPort`/`RepoPort` defined in Task 3 and used identically in Tasks 4–10; `namespaceFor` defined in Task 6, consumed in Task 10; `PublishResult` shape produced in Task 6 and returned verbatim in Task 7. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Notes carried as accepted risk (from spec §11):** append-only re-publish (stale memories), open publish endpoint, staging relayer latency. Not blockers for v1.
