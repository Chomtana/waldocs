# waldocs Platform Implementation Plan (rev. 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the waldocs platform — a Next.js backend + browse UI and a Claude Code `waldocs-publish` skill. Apps post step-by-step markdown; the backend uses Gemini to structure it, merge it into protocol docs, and curate showcases; everything is stored on Walrus Memory and indexed in Postgres.

**Architecture:** Next.js (App Router) hosts APIs + UI. `POST /api/publish` runs a Gemini pipeline (structure app doc → for each used protocol, whole-doc merge with improve-or-keep → curate showcase), writing modular units to Walrus Memory (one namespace per entity-version) and caching structure/plaintext in Postgres. Chat/ask are Gemini RAG over Walrus `recall`. All side-effecting collaborators are behind injectable ports (`MemwalPort`, `RepoPort`, `LlmPort`) so logic is unit-tested with fakes (no live Gemini/Walrus in unit tests).

**Tech Stack:** TypeScript, Next.js 15 (App Router), PostgreSQL + Prisma, zod, `@mysten-incubation/memwal`, `ai` (SDK 5; Vercel AI Gateway → Gemini), vitest, pnpm.

## Global Constraints

- **Network: testnet only.** MemWal **staging** relayer `https://relayer-staging.memory.walrus.xyz`; `suiNetwork: "testnet"`; testnet IDs `MEMWAL_PACKAGE_ID=0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6`, `MEMWAL_REGISTRY_ID=0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437`.
- **Gemini model id from `GEMINI_MODEL`** (default `gemini-3.1-flash-lite`) routed via the **Vercel AI Gateway** as `google/<GEMINI_MODEL>` (`ai` SDK 5, auth `AI_GATEWAY_API_KEY`/OIDC). Confirm the gateway slug resolves before pinning.
- **Publish input = app step-by-step markdown only.** `entity.type` is always `application`.
- **Protocols are pure merge targets** — stub on first reference; content synthesized by `mergeProtocolDoc`. The synthesized doc always keeps a `GETTING STARTED` group with units `Introduction` + `Getting Started`.
- **Namespaces:** protocol `proto.<slug>`; app `<author>/<repo>/<commit>`; reserved `_toc`.
- **The skill never calls Walrus Memory directly** — only the backend.
- **Server-only secrets:** delegate key + Gemini key. Never import `lib/memwal.ts` / `lib/llm.ts` into client components.
- **Auth: none in v1.** Re-publish = append + version bump; latest version renders.
- **All LLM/Walrus access behind ports** (`LlmPort`, `MemwalPort`, `RepoPort`); unit tests use fakes only.
- Package manager **pnpm**; Node ≥ 18.

---

## File Structure

```
waldocs/
  package.json, pnpm-workspace.yaml, docker-compose.yml, .gitignore
  apps/web/
    .env.example                       # env template (copy to apps/web/.env)
    package.json, tsconfig.json, next.config.ts, vitest.config.ts
    prisma/schema.prisma
    src/lib/types.ts        # domain types + ports (no deps)
    src/lib/toc.ts          # _toc header encode/decode
    src/lib/validation.ts   # zod publish schema
    src/lib/db.ts           # Prisma singleton
    src/lib/repo.ts         # RepoPort (Prisma-backed)
    src/lib/memwal.ts       # MemwalPort (SDK wrapper)
    src/lib/llm.ts          # LlmPort (Gemini via Vercel AI SDK)
    src/lib/publish.ts      # publishApp(input, deps) — the pipeline
    src/lib/chat.ts         # globalChat / entityAsk (Gemini RAG)
    src/lib/queries.ts      # read models for UI/API
    src/app/api/**/route.ts
    src/app/page.tsx, protocol/[slug]/page.tsx, app/[author]/[repo]/page.tsx
    src/app/_components/{ChatBox,AskBox}.tsx
  scripts/seed-account.ts
  packages/skill/waldocs-publish/SKILL.md
```

---

## Task 1: Workspace scaffold + tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `docker-compose.yml`, `.gitignore`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/vitest.config.ts`, `apps/web/src/app/layout.tsx`, `apps/web/test/smoke.test.ts`
- Note: `apps/web/.env.example` already exists — leave it (it's the env template; copy to `apps/web/.env`).

**Interfaces:**
- Produces: buildable Next.js app under `apps/web`; `pnpm --filter web test` runs vitest; `pnpm seed:account` loads `apps/web/.env`.

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
    "seed:account": "tsx --env-file=apps/web/.env scripts/seed-account.ts"
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
    "ai": "^5.0.0",
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
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
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

- [ ] **Step 4: Install and run**

Run: `pnpm install && pnpm --filter web test`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm workspace + next.js app + vitest"
```

---

## Task 2: Prisma schema, client, migration

**Files:**
- Create: `apps/web/prisma/schema.prisma`, `apps/web/src/lib/db.ts`
- Test: `apps/web/test/schema.test.ts`

**Interfaces:**
- Produces: models `Protocol`, `Application`, `ApplicationProtocol`, `Document`, `DocUnit`, `ShowcaseEntry`, `PublishEvent`; `db` singleton.

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
  showcase    ShowcaseEntry[]
}

model Application {
  id           String   @id @default(uuid())
  slug         String   @unique   // "<author>/<repo>"
  author       String
  repo         String
  name         String
  description  String?
  namespace    String             // latest "<author>/<repo>/<commit>"
  latestCommit String?
  repoUrl      String?
  tocBlobId    String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  protocols    ApplicationProtocol[]
  showcase     ShowcaseEntry[]
}

model ApplicationProtocol {
  applicationId String
  protocolId    String
  application   Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  protocol      Protocol    @relation(fields: [protocolId], references: [id], onDelete: Cascade)
  @@id([applicationId, protocolId])
}

model Document {
  id            String    @id @default(uuid())
  entityType    String    // "protocol" | "application"
  entityId      String
  version       Int
  commitHash    String?
  namespace     String
  title         String
  summary       String
  sourceMarkdown String?  // apps only
  createdAt     DateTime  @default(now())
  units         DocUnit[]
  @@index([entityType, entityId, version])
}

model DocUnit {
  id           String   @id @default(uuid())
  documentId   String
  document     Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  ord          Int
  groupTitle   String?  // protocols: sidebar section; apps: null
  title        String
  contentCache String
  walrusBlobId String
  namespace    String
  createdAt    DateTime @default(now())
}

model ShowcaseEntry {
  id              String   @id @default(uuid())
  protocolId      String
  applicationId   String
  protocol        Protocol    @relation(fields: [protocolId], references: [id], onDelete: Cascade)
  application     Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  descriptiveTitle String
  simplicityRank  Int
  clusterKey      String
  createdAt       DateTime @default(now())
  @@unique([protocolId, applicationId])
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

- [ ] **Step 2: Prisma client singleton**

`apps/web/src/lib/db.ts`:
```ts
import { PrismaClient } from "@prisma/client";
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = db;
```

- [ ] **Step 3: Generate client + migrate**

Run:
```bash
docker compose up -d db
cd apps/web && npx prisma migrate dev --name init
```
Expected: migration `init` applied; client generated.

- [ ] **Step 4: Schema sanity test**

`apps/web/test/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
describe("prisma schema", () => {
  it("exposes the expected models", () => {
    const models = Prisma.dmmf.datamodel.models.map((m) => m.name).sort();
    expect(models).toEqual(
      ["Application", "ApplicationProtocol", "DocUnit", "Document", "Protocol", "PublishEvent", "ShowcaseEntry"].sort(),
    );
  });
});
```

- [ ] **Step 5: Run it**

Run: `pnpm --filter web test schema`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add prisma schema (units, showcase) + client + migration"
```

---

## Task 3: Domain types, ports, and TOC helpers

**Files:**
- Create: `apps/web/src/lib/types.ts`, `apps/web/src/lib/toc.ts`
- Test: `apps/web/test/toc.test.ts`

**Interfaces:**
- Produces:
  - `EntityType`, `GroupedUnit = { group: string | null; title: string; content: string }`, `Step = { title: string; content: string }`
  - `PublishInput`, `PublishResult`
  - `MemwalPort { remember(text,ns): Promise<{blobId}>; recall(query,ns,opts?): Promise<{results:{blobId,text,distance}[]}>; health(): Promise<{status}> }`
  - `LlmPort { structureAppDoc; mergeProtocolDoc; curateShowcase; answerOverContext }` (signatures below)
  - `RepoPort` (DB methods used by publish/chat)
  - `encodeTocHeader`, `decodeTocHeader`

- [ ] **Step 1: Write the types/ports module**

`apps/web/src/lib/types.ts`:
```ts
export type EntityType = "protocol" | "application";

export interface GroupedUnit { group: string | null; title: string; content: string }
export interface Step { title: string; content: string }

export interface PublishInput {
  entity: {
    type: "application";
    slug: string;            // "<author>/<repo>"
    name?: string;
    description?: string;
    repoUrl?: string;
    commitHash: string;
  };
  markdown: string;
  usesProtocols: string[];
}

export interface PublishResult {
  url: string;
  slug: string;
  documentId: string;
  version: number;
  namespace: string;
  blobIds: string[];
  tocBlobId: string;
  mergedProtocols: { slug: string; changed: boolean }[];
}

export interface MemwalPort {
  remember(text: string, namespace: string): Promise<{ blobId: string }>;
  recall(
    query: string,
    namespace: string,
    opts?: { limit?: number; maxDistance?: number },
  ): Promise<{ results: { blobId: string; text: string; distance: number }[] }>;
  health(): Promise<{ status: string }>;
}

export interface LlmPort {
  structureAppDoc(markdown: string): Promise<{ name: string; summary: string; steps: Step[] }>;
  mergeProtocolDoc(args: {
    protocolName: string;
    currentDoc: GroupedUnit[];
    appName: string;
    appSteps: Step[];
  }): Promise<{ changed: boolean; doc?: GroupedUnit[]; summary?: string; description?: string }>;
  curateShowcase(args: {
    protocolName: string;
    candidates: { slug: string; name: string; summary: string }[];
  }): Promise<{ entries: { slug: string; descriptiveTitle: string; simplicityRank: number; clusterKey: string }[] }>;
  answerOverContext(args: {
    question: string;
    context: { label: string; text: string }[];
  }): Promise<{ answer: string; usedLabels: string[] }>;
}

export interface UpsertProtocolArgs { slug: string; name: string; description?: string; namespace: string }
export interface UpsertAppArgs {
  slug: string; author: string; repo: string; name: string;
  description?: string; namespace: string; latestCommit: string; repoUrl?: string;
}
export interface InsertUnitArgs {
  documentId: string; ord: number; groupTitle: string | null;
  title: string; contentCache: string; walrusBlobId: string; namespace: string;
}

export interface RepoPort {
  upsertProtocolBySlug(args: UpsertProtocolArgs): Promise<{ id: string }>;
  upsertApplication(args: UpsertAppArgs): Promise<{ id: string }>;
  linkAppProtocol(applicationId: string, protocolId: string): Promise<void>;
  nextVersion(entityId: string): Promise<number>;
  createDocument(args: {
    entityType: EntityType; entityId: string; version: number; commitHash?: string;
    namespace: string; title: string; summary: string; sourceMarkdown?: string;
  }): Promise<{ id: string }>;
  insertUnit(args: InsertUnitArgs): Promise<void>;
  setEntityToc(entityType: EntityType, entityId: string, tocBlobId: string): Promise<void>;
  setProtocolDescription(protocolId: string, description: string): Promise<void>;
  latestProtocolUnits(protocolId: string): Promise<GroupedUnit[]>;
  linkedApps(protocolId: string): Promise<{ id: string; slug: string; name: string; summary: string }[]>;
  replaceShowcase(
    protocolId: string,
    entries: { slug: string; descriptiveTitle: string; simplicityRank: number; clusterKey: string }[],
  ): Promise<void>;
  insertPublishEvent(args: { entityType: EntityType; entityId: string; documentId: string; meta?: unknown }): Promise<void>;
}
```

- [ ] **Step 2: Write the failing TOC test**

`apps/web/test/toc.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { encodeTocHeader, decodeTocHeader } from "@/lib/toc";

describe("toc header", () => {
  it("encodes a parseable header", () => {
    expect(encodeTocHeader("protocol", "walrus", "Walrus", "Storage.").startsWith("[protocol:walrus] Walrus — ")).toBe(true);
  });
  it("round-trips a slashed app slug", () => {
    const line = encodeTocHeader("application", "chomtana/waldocs", "waldocs", "Docs.");
    expect(decodeTocHeader(line)).toEqual({ type: "application", slug: "chomtana/waldocs" });
  });
  it("returns null on garbage", () => {
    expect(decodeTocHeader("no header")).toBeNull();
  });
});
```

- [ ] **Step 3: Run it (fails)**

Run: `pnpm --filter web test toc`
Expected: FAIL ("Cannot find module '@/lib/toc'").

- [ ] **Step 4: Implement the TOC helpers**

`apps/web/src/lib/toc.ts`:
```ts
import type { EntityType } from "./types";

export function encodeTocHeader(type: EntityType, slug: string, name: string, summary: string): string {
  return `[${type}:${slug}] ${name} — ${summary}`;
}

// app slugs contain a slash, so allow "/" in the slug capture
const HEADER_RE = /^\[(protocol|application):([a-z0-9/_-]+)\]/i;

export function decodeTocHeader(text: string): { type: EntityType; slug: string } | null {
  const m = HEADER_RE.exec(text.trim());
  if (!m) return null;
  return { type: m[1].toLowerCase() as EntityType, slug: m[2] };
}
```

- [ ] **Step 5: Run it (passes)**

Run: `pnpm --filter web test toc`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add domain types, ports (Memwal/Llm/Repo), TOC helpers"
```

---

## Task 4: Repo layer (Prisma-backed RepoPort)

**Files:**
- Create: `apps/web/src/lib/repo.ts`
- Test: `apps/web/test/repo.test.ts` (integration — local Postgres)

**Interfaces:**
- Consumes: `db` (Task 2), `RepoPort` (Task 3).
- Produces: `repo: RepoPort`.

- [ ] **Step 1: Write the failing integration test**

`apps/web/test/repo.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { repo } from "@/lib/repo";
import { db } from "@/lib/db";

beforeEach(async () => {
  await db.docUnit.deleteMany();
  await db.document.deleteMany();
  await db.showcaseEntry.deleteMany();
  await db.applicationProtocol.deleteMany();
  await db.application.deleteMany();
  await db.protocol.deleteMany();
  await db.publishEvent.deleteMany();
});

describe("repo", () => {
  it("upserts a protocol by slug", async () => {
    const a = await repo.upsertProtocolBySlug({ slug: "walrus", name: "Walrus", namespace: "proto.walrus" });
    const b = await repo.upsertProtocolBySlug({ slug: "walrus", name: "Walrus", namespace: "proto.walrus" });
    expect(a.id).toBe(b.id);
  });

  it("upserts an application and increments version", async () => {
    const e = await repo.upsertApplication({
      slug: "chomtana/waldocs", author: "chomtana", repo: "waldocs", name: "waldocs",
      namespace: "chomtana/waldocs/abc", latestCommit: "abc",
    });
    expect(await repo.nextVersion(e.id)).toBe(1);
    await repo.createDocument({ entityType: "application", entityId: e.id, version: 1, namespace: "chomtana/waldocs/abc", title: "waldocs", summary: "s" });
    expect(await repo.nextVersion(e.id)).toBe(2);
  });

  it("reads latest protocol units grouped + ordered", async () => {
    const p = await repo.upsertProtocolBySlug({ slug: "walrus", name: "Walrus", namespace: "proto.walrus" });
    const d = await repo.createDocument({ entityType: "protocol", entityId: p.id, version: 1, namespace: "proto.walrus", title: "Walrus", summary: "s" });
    await repo.insertUnit({ documentId: d.id, ord: 1, groupTitle: "GETTING STARTED", title: "Getting Started", contentCache: "g", walrusBlobId: "b2", namespace: "proto.walrus" });
    await repo.insertUnit({ documentId: d.id, ord: 0, groupTitle: "GETTING STARTED", title: "Introduction", contentCache: "i", walrusBlobId: "b1", namespace: "proto.walrus" });
    const units = await repo.latestProtocolUnits(p.id);
    expect(units.map((u) => u.title)).toEqual(["Introduction", "Getting Started"]);
    expect(units[0].group).toBe("GETTING STARTED");
  });

  it("replaces showcase entries", async () => {
    const p = await repo.upsertProtocolBySlug({ slug: "walrus", name: "Walrus", namespace: "proto.walrus" });
    const app = await repo.upsertApplication({ slug: "a/b", author: "a", repo: "b", name: "b", namespace: "a/b/c", latestCommit: "c" });
    await repo.linkAppProtocol(app.id, p.id);
    await repo.replaceShowcase(p.id, [{ slug: "a/b", descriptiveTitle: "Demo app", simplicityRank: 0, clusterKey: "k1" }]);
    await repo.replaceShowcase(p.id, [{ slug: "a/b", descriptiveTitle: "Demo app v2", simplicityRank: 0, clusterKey: "k1" }]);
    const rows = await db.showcaseEntry.findMany({ where: { protocolId: p.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].descriptiveTitle).toBe("Demo app v2");
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `docker compose up -d db && pnpm --filter web test repo`
Expected: FAIL ("Cannot find module '@/lib/repo'").

- [ ] **Step 3: Implement the repo**

`apps/web/src/lib/repo.ts`:
```ts
import { db } from "./db";
import type { EntityType, GroupedUnit, RepoPort, UpsertProtocolArgs, UpsertAppArgs, InsertUnitArgs } from "./types";

export const repo: RepoPort = {
  async upsertProtocolBySlug(args: UpsertProtocolArgs) {
    const row = await db.protocol.upsert({
      where: { slug: args.slug },
      create: { slug: args.slug, name: args.name, description: args.description ?? null, namespace: args.namespace },
      update: { name: args.name },
    });
    return { id: row.id };
  },

  async upsertApplication(args: UpsertAppArgs) {
    const data = {
      author: args.author, repo: args.repo, name: args.name,
      description: args.description ?? null, namespace: args.namespace,
      latestCommit: args.latestCommit, repoUrl: args.repoUrl ?? null,
    };
    const row = await db.application.upsert({ where: { slug: args.slug }, create: { slug: args.slug, ...data }, update: data });
    return { id: row.id };
  },

  async linkAppProtocol(applicationId, protocolId) {
    await db.applicationProtocol.upsert({
      where: { applicationId_protocolId: { applicationId, protocolId } },
      create: { applicationId, protocolId },
      update: {},
    });
  },

  async nextVersion(entityId) {
    const last = await db.document.findFirst({ where: { entityId }, orderBy: { version: "desc" }, select: { version: true } });
    return (last?.version ?? 0) + 1;
  },

  async createDocument(args) {
    const row = await db.document.create({
      data: {
        entityType: args.entityType, entityId: args.entityId, version: args.version,
        commitHash: args.commitHash ?? null, namespace: args.namespace,
        title: args.title, summary: args.summary, sourceMarkdown: args.sourceMarkdown ?? null,
      },
    });
    return { id: row.id };
  },

  async insertUnit(args: InsertUnitArgs) {
    await db.docUnit.create({ data: args });
  },

  async setEntityToc(entityType: EntityType, entityId, tocBlobId) {
    if (entityType === "protocol") await db.protocol.update({ where: { id: entityId }, data: { tocBlobId } });
    else await db.application.update({ where: { id: entityId }, data: { tocBlobId } });
  },

  async setProtocolDescription(protocolId, description) {
    await db.protocol.update({ where: { id: protocolId }, data: { description } });
  },

  async latestProtocolUnits(protocolId): Promise<GroupedUnit[]> {
    const latest = await db.document.findFirst({ where: { entityId: protocolId, entityType: "protocol" }, orderBy: { version: "desc" } });
    if (!latest) return [];
    const units = await db.docUnit.findMany({ where: { documentId: latest.id }, orderBy: { ord: "asc" } });
    return units.map((u) => ({ group: u.groupTitle, title: u.title, content: u.contentCache }));
  },

  async linkedApps(protocolId) {
    const links = await db.applicationProtocol.findMany({ where: { protocolId }, include: { application: true } });
    const out: { id: string; slug: string; name: string; summary: string }[] = [];
    for (const l of links) {
      const latest = await db.document.findFirst({ where: { entityId: l.application.id }, orderBy: { version: "desc" }, select: { summary: true } });
      out.push({ id: l.application.id, slug: l.application.slug, name: l.application.name, summary: latest?.summary ?? "" });
    }
    return out;
  },

  async replaceShowcase(protocolId, entries) {
    await db.$transaction(async (tx) => {
      await tx.showcaseEntry.deleteMany({ where: { protocolId } });
      for (const e of entries) {
        const app = await tx.application.findUnique({ where: { slug: e.slug } });
        if (!app) continue;
        await tx.showcaseEntry.create({
          data: { protocolId, applicationId: app.id, descriptiveTitle: e.descriptiveTitle, simplicityRank: e.simplicityRank, clusterKey: e.clusterKey },
        });
      }
    });
  },

  async insertPublishEvent(args) {
    await db.publishEvent.create({
      data: { entityType: args.entityType, entityId: args.entityId, documentId: args.documentId, meta: (args.meta ?? undefined) as object | undefined },
    });
  },
};
```

- [ ] **Step 4: Run it (passes)**

Run: `pnpm --filter web test repo`
Expected: PASS (4 tests).

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
- Produces: `createMemwal(client): MemwalPort`, `getMemwal(): MemwalPort`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/memwal.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createMemwal } from "@/lib/memwal";

function fakeClient() {
  return {
    rememberAndWait: vi.fn(async () => ({ blob_id: "blob-1" })),
    recall: vi.fn(async () => ({ results: [{ blob_id: "b", text: "t", distance: 0.2 }], total: 1 })),
    health: vi.fn(async () => ({ status: "ok" })),
  };
}

describe("memwal wrapper", () => {
  it("maps remember to blobId", async () => {
    const m = createMemwal(fakeClient() as never);
    expect(await m.remember("hi", "proto.walrus")).toEqual({ blobId: "blob-1" });
  });
  it("maps recall to camelCase", async () => {
    const m = createMemwal(fakeClient() as never);
    const r = await m.recall("q", "_toc", { maxDistance: 0.7 });
    expect(r.results[0]).toEqual({ blobId: "b", text: "t", distance: 0.2 });
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `pnpm --filter web test memwal`
Expected: FAIL ("Cannot find module '@/lib/memwal'").

- [ ] **Step 3: Implement the wrapper**

`apps/web/src/lib/memwal.ts`:
```ts
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
```

- [ ] **Step 4: Run it (passes)**

Run: `pnpm --filter web test memwal`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add MemWal wrapper behind MemwalPort"
```

---

## Task 6: Gemini wrapper (LlmPort) via Vercel AI SDK

**Files:**
- Create: `apps/web/src/lib/llm.ts`
- Test: `apps/web/test/llm.test.ts`

**Interfaces:**
- Consumes: `LlmPort` (Task 3), `ai`'s `generateObject` + `gateway` (Vercel AI Gateway).
- Produces: `createLlm(generate): LlmPort` (injects a `generateObject`-like fn for testing), `getLlm(): LlmPort`.

- [ ] **Step 1: Write the failing test (inject a fake generator)**

`apps/web/test/llm.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createLlm } from "@/lib/llm";

// Fake generateObject: returns a canned object per call, ignoring the prompt.
function fakeGen(obj: unknown) {
  return vi.fn(async () => ({ object: obj }));
}

describe("llm wrapper", () => {
  it("structureAppDoc returns parsed steps", async () => {
    const gen = fakeGen({ name: "waldocs", summary: "s", steps: [{ title: "Step 1", content: "c" }] });
    const llm = createLlm(gen as never);
    const out = await llm.structureAppDoc("# raw md");
    expect(out.steps).toEqual([{ title: "Step 1", content: "c" }]);
    expect(gen).toHaveBeenCalledOnce();
  });

  it("mergeProtocolDoc passes through changed=false", async () => {
    const llm = createLlm(fakeGen({ changed: false }) as never);
    const out = await llm.mergeProtocolDoc({ protocolName: "Walrus", currentDoc: [], appName: "x", appSteps: [] });
    expect(out.changed).toBe(false);
    expect(out.doc).toBeUndefined();
  });

  it("curateShowcase returns entries", async () => {
    const llm = createLlm(fakeGen({ entries: [{ slug: "a/b", descriptiveTitle: "Demo", simplicityRank: 0, clusterKey: "k" }] }) as never);
    const out = await llm.curateShowcase({ protocolName: "Walrus", candidates: [] });
    expect(out.entries[0].descriptiveTitle).toBe("Demo");
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `pnpm --filter web test llm`
Expected: FAIL ("Cannot find module '@/lib/llm'").

- [ ] **Step 3: Implement the Gemini wrapper**

`apps/web/src/lib/llm.ts`:
```ts
import "server-only";
import { z } from "zod";
import { generateObject, gateway } from "ai";
import type { LlmPort } from "./types";

const stepSchema = z.object({ title: z.string(), content: z.string() });
const unitSchema = z.object({ group: z.string().nullable(), title: z.string(), content: z.string() });

const structureSchema = z.object({ name: z.string(), summary: z.string(), steps: z.array(stepSchema) });
const mergeSchema = z.object({
  changed: z.boolean(),
  doc: z.array(unitSchema).optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
});
const showcaseSchema = z.object({
  entries: z.array(z.object({ slug: z.string(), descriptiveTitle: z.string(), simplicityRank: z.number(), clusterKey: z.string() })),
});
const answerSchema = z.object({ answer: z.string(), usedLabels: z.array(z.string()) });

// Injected generator mirrors ai's generateObject signature ({ object }).
type Gen = <T>(args: { schema: z.ZodType<T>; prompt: string }) => Promise<{ object: T }>;

export function createLlm(gen: Gen): LlmPort {
  return {
    async structureAppDoc(markdown) {
      const { object } = await gen({
        schema: structureSchema,
        prompt:
          "Break this app's step-by-step markdown into ordered modular steps (each step = exactly one action; " +
          "following them top-to-bottom must work). Return a short human title, a 1-3 sentence summary, and the steps.\n\n" +
          markdown,
      });
      return object;
    },
    async mergeProtocolDoc({ protocolName, currentDoc, appName, appSteps }) {
      const { object } = await gen({
        schema: mergeSchema,
        prompt:
          `You maintain the developer docs for the protocol "${protocolName}". The doc is an ordered list of units, ` +
          `each with a sidebar group, and MUST keep a "GETTING STARTED" group containing units titled "Introduction" and "Getting Started". ` +
          `Given the current doc and a new app's experience, return changed=true with the FULL improved doc ONLY if the app genuinely ` +
          `improves it (new feature coverage, clearer steps); otherwise return changed=false.\n\n` +
          `CURRENT_DOC:\n${JSON.stringify(currentDoc)}\n\nAPP "${appName}" STEPS:\n${JSON.stringify(appSteps)}`,
      });
      return object;
    },
    async curateShowcase({ protocolName, candidates }) {
      const { object } = await gen({
        schema: showcaseSchema,
        prompt:
          `Curate a showcase of NOTABLE apps for protocol "${protocolName}". Sort simplest first (simplicityRank 0 = simplest). ` +
          `Group correlated apps that do the same thing under a shared clusterKey and keep only the best one per cluster. ` +
          `Give each a short descriptive title (e.g. "Unified document application"), NOT the repo slug.\n\n` +
          `CANDIDATES:\n${JSON.stringify(candidates)}`,
      });
      return object;
    },
    async answerOverContext({ question, context }) {
      const { object } = await gen({
        schema: answerSchema,
        prompt:
          `Answer the question using ONLY the labeled context. Cite the labels you used in usedLabels. ` +
          `If the context is insufficient, say so.\n\nQUESTION: ${question}\n\nCONTEXT:\n` +
          context.map((c) => `[${c.label}] ${c.text}`).join("\n\n"),
      });
      return object;
    },
  };
}

function defaultGen(): Gen {
  const model = gateway(`google/${process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite"}`);
  return (args) => generateObject({ model, schema: args.schema, prompt: args.prompt });
}

let singleton: LlmPort | null = null;
export function getLlm(): LlmPort {
  if (!singleton) singleton = createLlm(defaultGen());
  return singleton;
}
```

- [ ] **Step 4: Run it (passes)**

Run: `pnpm --filter web test llm`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Gemini LlmPort wrapper (structure/merge/curate/answer)"
```

---

## Task 7: Publish pipeline (app → structure → merge → showcase)

**Files:**
- Create: `apps/web/src/lib/publish.ts`
- Test: `apps/web/test/publish.test.ts`

**Interfaces:**
- Consumes: `PublishInput`, `PublishResult`, `MemwalPort`, `RepoPort`, `LlmPort`, `GroupedUnit` (Task 3); `encodeTocHeader` (Task 3).
- Produces: `publishApp(input, deps: { repo; memwal; llm; baseUrl }): Promise<PublishResult>`; `protocolNamespace(slug)`, `appNamespace(slug, commit)`, `parseSlug(slug): { author; repo }`.

- [ ] **Step 1: Write the failing test with fakes for all three ports**

`apps/web/test/publish.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { publishApp, protocolNamespace, appNamespace, parseSlug } from "@/lib/publish";
import type { MemwalPort, RepoPort, LlmPort, PublishInput, GroupedUnit } from "@/lib/types";

function fakes(mergeChanged: boolean) {
  const log = { remembered: [] as { text: string; ns: string }[], showcaseFor: [] as string[], protoVersions: 0 };
  let blob = 0;
  const memwal: MemwalPort = {
    async remember(text, ns) { log.remembered.push({ text, ns }); return { blobId: `blob-${++blob}` }; },
    async recall() { return { results: [] }; },
    async health() { return { status: "ok" }; },
  };
  const repo: RepoPort = {
    async upsertProtocolBySlug() { return { id: "proto-1" }; },
    async upsertApplication() { return { id: "app-1" }; },
    async linkAppProtocol() {},
    async nextVersion() { return 1; },
    async createDocument(a) { if (a.entityType === "protocol") log.protoVersions++; return { id: `doc-${a.entityType}` }; },
    async insertUnit() {},
    async setEntityToc() {},
    async setProtocolDescription() {},
    async latestProtocolUnits() { return [] as GroupedUnit[]; },
    async linkedApps() { return [{ id: "app-1", slug: "chomtana/waldocs", name: "waldocs", summary: "s" }]; },
    async replaceShowcase(id) { log.showcaseFor.push(id); },
    async insertPublishEvent() {},
  };
  const llm: LlmPort = {
    async structureAppDoc() { return { name: "waldocs", summary: "Docs.", steps: [{ title: "Step 1", content: "a" }, { title: "Step 2", content: "b" }] }; },
    async mergeProtocolDoc() {
      return mergeChanged
        ? { changed: true, doc: [{ group: "GETTING STARTED", title: "Introduction", content: "i" }], summary: "ps", description: "pd" }
        : { changed: false };
    },
    async curateShowcase() { return { entries: [{ slug: "chomtana/waldocs", descriptiveTitle: "Docs app", simplicityRank: 0, clusterKey: "k" }] }; },
    async answerOverContext() { return { answer: "", usedLabels: [] }; },
  };
  return { memwal, repo, llm, log };
}

const input: PublishInput = {
  entity: { type: "application", slug: "chomtana/waldocs", commitHash: "a7d490d", repoUrl: "https://x" },
  markdown: "## Step 1\n...\n## Step 2\n...",
  usesProtocols: ["walrus"],
};

describe("namespaces + slug", () => {
  it("computes namespaces", () => {
    expect(protocolNamespace("walrus")).toBe("proto.walrus");
    expect(appNamespace("chomtana/waldocs", "a7d490d")).toBe("chomtana/waldocs/a7d490d");
  });
  it("parses slug", () => {
    expect(parseSlug("chomtana/waldocs")).toEqual({ author: "chomtana", repo: "waldocs" });
  });
});

describe("publishApp", () => {
  it("writes app steps to the app namespace then the TOC", async () => {
    const { memwal, repo, llm, log } = fakes(false);
    const res = await publishApp(input, { repo, memwal, llm, baseUrl: "http://h" });
    const appNs = "chomtana/waldocs/a7d490d";
    expect(log.remembered.slice(0, 2).map((r) => r.ns)).toEqual([appNs, appNs]);
    expect(log.remembered[2].ns).toBe("_toc");
    expect(log.remembered[2].text.startsWith("[application:chomtana/waldocs]")).toBe(true);
    expect(res.blobIds).toEqual(["blob-1", "blob-2"]);
    expect(res.url).toBe("http://h/app/chomtana/waldocs");
    expect(res.mergedProtocols).toEqual([{ slug: "walrus", changed: false }]);
  });

  it("when merge is unchanged, writes NO protocol document", async () => {
    const { memwal, repo, llm, log } = fakes(false);
    await publishApp(input, { repo, memwal, llm, baseUrl: "http://h" });
    expect(log.protoVersions).toBe(0);
  });

  it("when merge improves, writes a protocol document + curates showcase", async () => {
    const { memwal, repo, llm, log } = fakes(true);
    const res = await publishApp(input, { repo, memwal, llm, baseUrl: "http://h" });
    expect(log.protoVersions).toBe(1);
    expect(log.showcaseFor).toEqual(["proto-1"]);
    expect(res.mergedProtocols).toEqual([{ slug: "walrus", changed: true }]);
  });

  it("rejects a non-author/repo slug", async () => {
    const { memwal, repo, llm } = fakes(false);
    await expect(
      publishApp({ ...input, entity: { ...input.entity, slug: "bare" } }, { repo, memwal, llm, baseUrl: "http://h" }),
    ).rejects.toThrow(/author\/repo/i);
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `pnpm --filter web test publish`
Expected: FAIL ("Cannot find module '@/lib/publish'").

- [ ] **Step 3: Implement the pipeline**

`apps/web/src/lib/publish.ts`:
```ts
import type { LlmPort, MemwalPort, PublishInput, PublishResult, RepoPort } from "./types";
import { encodeTocHeader } from "./toc";

export function protocolNamespace(slug: string): string { return `proto.${slug}`; }
export function appNamespace(slug: string, commit: string): string { return `${slug}/${commit}`; }
export function parseSlug(slug: string): { author: string; repo: string } {
  const m = /^([^/]+)\/([^/]+)$/.exec(slug);
  if (!m) throw new Error(`Application slug must be "author/repo", got: ${slug}`);
  return { author: m[1], repo: m[2] };
}

export async function publishApp(
  input: PublishInput,
  deps: { repo: RepoPort; memwal: MemwalPort; llm: LlmPort; baseUrl: string },
): Promise<PublishResult> {
  const { repo, memwal, llm, baseUrl } = deps;
  const { entity, markdown, usesProtocols } = input;

  const { author, repo: repoName } = parseSlug(entity.slug); // throws on bad slug
  if (!markdown.trim()) throw new Error("markdown is required.");

  // 1) structure
  const structured = await llm.structureAppDoc(markdown);
  const appName = entity.name ?? structured.name;

  // 2) store app
  const ns = appNamespace(entity.slug, entity.commitHash);
  const { id: appId } = await repo.upsertApplication({
    slug: entity.slug, author, repo: repoName, name: appName,
    description: entity.description, namespace: ns, latestCommit: entity.commitHash, repoUrl: entity.repoUrl,
  });
  const version = await repo.nextVersion(appId);
  const { id: documentId } = await repo.createDocument({
    entityType: "application", entityId: appId, version, commitHash: entity.commitHash,
    namespace: ns, title: appName, summary: structured.summary, sourceMarkdown: markdown,
  });

  const blobIds: string[] = [];
  for (let i = 0; i < structured.steps.length; i++) {
    const s = structured.steps[i];
    const { blobId } = await memwal.remember(s.content, ns);
    await repo.insertUnit({ documentId, ord: i, groupTitle: null, title: s.title, contentCache: s.content, walrusBlobId: blobId, namespace: ns });
    blobIds.push(blobId);
  }

  const appTocLine = encodeTocHeader("application", entity.slug, appName, structured.summary);
  const { blobId: tocBlobId } = await memwal.remember(appTocLine, "_toc");
  await repo.setEntityToc("application", appId, tocBlobId);

  // 3) merge into each used protocol
  const mergedProtocols: { slug: string; changed: boolean }[] = [];
  for (const protoSlug of usesProtocols) {
    const { id: protocolId } = await repo.upsertProtocolBySlug({ slug: protoSlug, name: protoSlug, namespace: protocolNamespace(protoSlug) });
    await repo.linkAppProtocol(appId, protocolId);

    const currentDoc = await repo.latestProtocolUnits(protocolId);
    const merge = await llm.mergeProtocolDoc({ protocolName: protoSlug, currentDoc, appName, appSteps: structured.steps });

    if (merge.changed && merge.doc) {
      const pNs = protocolNamespace(protoSlug);
      const pVersion = await repo.nextVersion(protocolId);
      const { id: pDocId } = await repo.createDocument({
        entityType: "protocol", entityId: protocolId, version: pVersion, namespace: pNs,
        title: protoSlug, summary: merge.summary ?? "",
      });
      for (let i = 0; i < merge.doc.length; i++) {
        const u = merge.doc[i];
        const { blobId } = await memwal.remember(u.content, pNs);
        await repo.insertUnit({ documentId: pDocId, ord: i, groupTitle: u.group, title: u.title, contentCache: u.content, walrusBlobId: blobId, namespace: pNs });
      }
      if (merge.description) await repo.setProtocolDescription(protocolId, merge.description);
      const pTocLine = encodeTocHeader("protocol", protoSlug, protoSlug, merge.summary ?? "");
      const { blobId: pToc } = await memwal.remember(pTocLine, "_toc");
      await repo.setEntityToc("protocol", protocolId, pToc);
    }
    mergedProtocols.push({ slug: protoSlug, changed: Boolean(merge.changed) });

    // 4) curate showcase for this protocol
    const candidates = await repo.linkedApps(protocolId);
    const { entries } = await llm.curateShowcase({ protocolName: protoSlug, candidates: candidates.map((c) => ({ slug: c.slug, name: c.name, summary: c.summary })) });
    await repo.replaceShowcase(protocolId, entries);
  }

  await repo.insertPublishEvent({ entityType: "application", entityId: appId, documentId, meta: { repoUrl: entity.repoUrl, steps: structured.steps.length } });

  return { url: `${baseUrl}/app/${entity.slug}`, slug: entity.slug, documentId, version, namespace: ns, blobIds, tocBlobId, mergedProtocols };
}
```

- [ ] **Step 4: Run it (passes)**

Run: `pnpm --filter web test publish`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add app publish pipeline (structure -> merge -> showcase)"
```

---

## Task 8: `POST /api/publish` route + validation

**Files:**
- Create: `apps/web/src/lib/validation.ts`, `apps/web/src/app/api/publish/route.ts`
- Test: `apps/web/test/publish-route.test.ts`

**Interfaces:**
- Consumes: `publishApp` (Task 7), `repo` (Task 4), `getMemwal` (Task 5), `getLlm` (Task 6).
- Produces: `publishSchema`; `POST` returning `PublishResult`.

- [ ] **Step 1: Write the failing route test (mock all libs)**

`apps/web/test/publish-route.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/repo", () => ({ repo: {} }));
vi.mock("@/lib/memwal", () => ({ getMemwal: () => ({}) }));
vi.mock("@/lib/llm", () => ({ getLlm: () => ({}) }));
vi.mock("@/lib/publish", () => ({
  publishApp: vi.fn(async (input: { entity: { slug: string } }) => ({
    url: `http://h/app/${input.entity.slug}`, slug: input.entity.slug, documentId: "d", version: 1,
    namespace: "ns", blobIds: ["b1"], tocBlobId: "t", mergedProtocols: [{ slug: "walrus", changed: true }],
  })),
}));

async function call(body: unknown) {
  const { POST } = await import("@/app/api/publish/route");
  return POST(new Request("http://h/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

describe("POST /api/publish", () => {
  it("400s on invalid payload", async () => {
    expect((await call({ entity: { type: "application", slug: "bare" } })).status).toBe(400);
  });
  it("publishes a valid app", async () => {
    const res = await call({
      entity: { type: "application", slug: "chomtana/waldocs", commitHash: "a7d490d" },
      markdown: "## Step 1\nhi",
      usesProtocols: ["walrus"],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slug).toBe("chomtana/waldocs");
    expect(json.mergedProtocols[0].changed).toBe(true);
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `pnpm --filter web test publish-route`
Expected: FAIL ("Cannot find module '@/app/api/publish/route'").

- [ ] **Step 3: Implement validation**

`apps/web/src/lib/validation.ts`:
```ts
import { z } from "zod";

const protoSlug = z.string().regex(/^[a-z0-9-]+$/);
const appSlug = z.string().regex(/^[^/]+\/[^/]+$/, "slug must be author/repo");

export const publishSchema = z.object({
  entity: z.object({
    type: z.literal("application"),
    slug: appSlug,
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    repoUrl: z.string().url().optional(),
    commitHash: z.string().min(1),
  }),
  markdown: z.string().min(1),
  usesProtocols: z.array(protoSlug).default([]),
});
export type PublishBody = z.infer<typeof publishSchema>;
```

- [ ] **Step 4: Implement the route**

`apps/web/src/app/api/publish/route.ts`:
```ts
import { NextResponse } from "next/server";
import { publishSchema } from "@/lib/validation";
import { publishApp } from "@/lib/publish";
import { repo } from "@/lib/repo";
import { getMemwal } from "@/lib/memwal";
import { getLlm } from "@/lib/llm";

export const maxDuration = 120; // publish runs several Gemini + Walrus calls

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
  try {
    const result = await publishApp(parsed.data, { repo, memwal: getMemwal(), llm: getLlm(), baseUrl });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run it (passes)**

Run: `pnpm --filter web test publish-route`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add POST /api/publish route + zod validation"
```

---

## Task 9: Chat + ask (Gemini RAG)

**Files:**
- Create: `apps/web/src/lib/chat.ts`, `apps/web/src/app/api/chat/route.ts`, `apps/web/src/app/api/ask/route.ts`
- Test: `apps/web/test/chat.test.ts`

**Interfaces:**
- Consumes: `MemwalPort`, `LlmPort` (Task 3), `decodeTocHeader` (Task 3), `protocolNamespace`/`appNamespace` not needed (entity namespace passed in).
- Produces: `globalChat(question, { memwal, llm, resolveNamespace }): Promise<{ answer; citations }>`; `entityAsk(question, namespace, label, { memwal, llm })`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/chat.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { globalChat, entityAsk } from "@/lib/chat";
import type { MemwalPort, LlmPort } from "@/lib/types";

function memwalWith(tocHits: { text: string }[], perNs: Record<string, string[]>): MemwalPort {
  return {
    async remember() { return { blobId: "x" }; },
    async recall(_q, ns) {
      if (ns === "_toc") return { results: tocHits.map((t, i) => ({ blobId: `t${i}`, text: t.text, distance: 0.1 })) };
      return { results: (perNs[ns] ?? []).map((text, i) => ({ blobId: `${ns}-${i}`, text, distance: 0.2 })) };
    },
    async health() { return { status: "ok" }; },
  };
}

const llm: LlmPort = {
  async structureAppDoc() { return { name: "", summary: "", steps: [] }; },
  async mergeProtocolDoc() { return { changed: false }; },
  async curateShowcase() { return { entries: [] }; },
  answerOverContext: vi.fn(async ({ context }) => ({ answer: `from ${context.length} ctx`, usedLabels: context.map((c) => c.label) })),
};

describe("globalChat", () => {
  it("resolves top entities and answers over their context", async () => {
    const memwal = memwalWith(
      [{ text: "[protocol:walrus] Walrus — storage" }, { text: "[application:a/b] b — demo" }],
      { "proto.walrus": ["walrus doc chunk"], "a/b/c": ["app step chunk"] },
    );
    const resolveNamespace = async (type: string, slug: string) =>
      type === "protocol" ? `proto.${slug}` : "a/b/c";
    const out = await globalChat("how to store?", { memwal, llm, resolveNamespace, topN: 3 });
    expect(out.answer).toContain("ctx");
    expect(out.citations.map((c) => c.slug).sort()).toEqual(["a/b", "walrus"]);
  });
});

describe("entityAsk", () => {
  it("answers over a single namespace", async () => {
    const memwal = memwalWith([], { "proto.walrus": ["chunk1", "chunk2"] });
    const out = await entityAsk("q", "proto.walrus", "walrus", { memwal, llm });
    expect(out.answer).toContain("ctx");
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `pnpm --filter web test chat`
Expected: FAIL ("Cannot find module '@/lib/chat'").

- [ ] **Step 3: Implement chat/ask logic**

`apps/web/src/lib/chat.ts`:
```ts
import type { EntityType, LlmPort, MemwalPort } from "./types";
import { decodeTocHeader } from "./toc";

const MAX_CTX_PER_ENTITY = 4;

export interface Citation { entityType: EntityType; slug: string }

export async function globalChat(
  question: string,
  deps: {
    memwal: MemwalPort;
    llm: LlmPort;
    resolveNamespace: (type: EntityType, slug: string) => Promise<string>;
    topN?: number;
  },
): Promise<{ answer: string; citations: Citation[] }> {
  const topN = deps.topN ?? 3;
  const toc = await deps.memwal.recall(question, "_toc", { limit: 10, maxDistance: 0.8 });

  const seen = new Set<string>();
  const entities: Citation[] = [];
  for (const r of toc.results) {
    const d = decodeTocHeader(r.text);
    if (!d) continue;
    const key = `${d.type}:${d.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push(d);
    if (entities.length >= topN) break;
  }

  const context: { label: string; text: string }[] = [];
  for (const e of entities) {
    const ns = await deps.resolveNamespace(e.type, e.slug);
    const hits = await deps.memwal.recall(question, ns, { limit: MAX_CTX_PER_ENTITY, maxDistance: 0.8 });
    for (const h of hits.results) context.push({ label: e.slug, text: h.text });
  }

  const { answer } = await deps.llm.answerOverContext({ question, context });
  return { answer, citations: entities };
}

export async function entityAsk(
  question: string,
  namespace: string,
  label: string,
  deps: { memwal: MemwalPort; llm: LlmPort },
): Promise<{ answer: string }> {
  const hits = await deps.memwal.recall(question, namespace, { limit: 6, maxDistance: 0.8 });
  const context = hits.results.map((h) => ({ label, text: h.text }));
  const { answer } = await deps.llm.answerOverContext({ question, context });
  return { answer };
}
```

- [ ] **Step 4: Implement the routes**

`apps/web/src/app/api/chat/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { globalChat } from "@/lib/chat";
import { getMemwal } from "@/lib/memwal";
import { getLlm } from "@/lib/llm";
import { db } from "@/lib/db";
import type { EntityType } from "@/lib/types";

export const maxDuration = 60;
const schema = z.object({ question: z.string().min(1) });

async function resolveNamespace(type: EntityType, slug: string): Promise<string> {
  if (type === "protocol") return `proto.${slug}`;
  const app = await db.application.findUnique({ where: { slug }, select: { namespace: true } });
  return app?.namespace ?? slug; // latest-commit namespace
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const out = await globalChat(parsed.data.question, { memwal: getMemwal(), llm: getLlm(), resolveNamespace });
  return NextResponse.json(out);
}
```

`apps/web/src/app/api/ask/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { entityAsk } from "@/lib/chat";
import { getMemwal } from "@/lib/memwal";
import { getLlm } from "@/lib/llm";
import { db } from "@/lib/db";

export const maxDuration = 60;
const schema = z.object({
  entityType: z.enum(["protocol", "application"]),
  slug: z.string().min(1),
  question: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const { entityType, slug, question } = parsed.data;
  let namespace = `proto.${slug}`;
  if (entityType === "application") {
    const app = await db.application.findUnique({ where: { slug }, select: { namespace: true } });
    if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
    namespace = app.namespace;
  }
  const out = await entityAsk(question, namespace, slug, { memwal: getMemwal(), llm: getLlm() });
  return NextResponse.json(out);
}
```

- [ ] **Step 5: Run it (passes)**

Run: `pnpm --filter web test chat`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Gemini RAG chat + per-entity ask"
```

---

## Task 10: Read queries + list/detail routes + healthz

**Files:**
- Create: `apps/web/src/lib/queries.ts`, `apps/web/src/app/api/protocols/route.ts`, `apps/web/src/app/api/protocols/[slug]/route.ts`, `apps/web/src/app/api/applications/[author]/[repo]/route.ts`, `apps/web/src/app/api/healthz/route.ts`
- Test: `apps/web/test/queries.test.ts` (integration — local Postgres)

**Interfaces:**
- Consumes: `db` (Task 2).
- Produces: `listProtocols()`, `getProtocol(slug)`, `getApplication(author, repo)` in `queries.ts`; four routes.

- [ ] **Step 1: Write the failing test**

`apps/web/test/queries.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { listProtocols, getProtocol, getApplication } from "@/lib/queries";

beforeEach(async () => {
  await db.docUnit.deleteMany();
  await db.document.deleteMany();
  await db.showcaseEntry.deleteMany();
  await db.applicationProtocol.deleteMany();
  await db.application.deleteMany();
  await db.protocol.deleteMany();
});

describe("queries", () => {
  it("lists protocols oldest-first", async () => {
    await db.protocol.create({ data: { slug: "a", name: "A", namespace: "proto.a", createdAt: new Date("2026-01-01") } });
    await db.protocol.create({ data: { slug: "b", name: "B", namespace: "proto.b", createdAt: new Date("2026-02-01") } });
    expect((await listProtocols()).map((p) => p.slug)).toEqual(["a", "b"]);
  });

  it("groups protocol units into ordered sections + showcase", async () => {
    const p = await db.protocol.create({ data: { slug: "walrus", name: "Walrus", namespace: "proto.walrus" } });
    const d = await db.document.create({ data: { entityType: "protocol", entityId: p.id, version: 1, namespace: "proto.walrus", title: "Walrus", summary: "s" } });
    await db.docUnit.create({ data: { documentId: d.id, ord: 0, groupTitle: "GETTING STARTED", title: "Introduction", contentCache: "i", walrusBlobId: "b", namespace: "proto.walrus" } });
    await db.docUnit.create({ data: { documentId: d.id, ord: 1, groupTitle: "GETTING STARTED", title: "Getting Started", contentCache: "g", walrusBlobId: "b", namespace: "proto.walrus" } });
    await db.docUnit.create({ data: { documentId: d.id, ord: 2, groupTitle: "MEMORY", title: "Write", contentCache: "w", walrusBlobId: "b", namespace: "proto.walrus" } });
    const app = await db.application.create({ data: { slug: "x/y", author: "x", repo: "y", name: "y", namespace: "x/y/c", latestCommit: "c" } });
    await db.showcaseEntry.create({ data: { protocolId: p.id, applicationId: app.id, descriptiveTitle: "Y app", simplicityRank: 0, clusterKey: "k" } });

    const detail = await getProtocol("walrus");
    expect(detail?.sections.map((s) => s.group)).toEqual(["GETTING STARTED", "MEMORY"]);
    expect(detail?.sections[0].units.map((u) => u.title)).toEqual(["Introduction", "Getting Started"]);
    expect(detail?.showcase[0]).toMatchObject({ descriptiveTitle: "Y app", slug: "x/y" });
  });

  it("returns latest-commit steps for an application", async () => {
    const app = await db.application.create({ data: { slug: "x/y", author: "x", repo: "y", name: "y", namespace: "x/y/c2", latestCommit: "c2" } });
    const d1 = await db.document.create({ data: { entityType: "application", entityId: app.id, version: 1, namespace: "x/y/c1", title: "y", summary: "s" } });
    const d2 = await db.document.create({ data: { entityType: "application", entityId: app.id, version: 2, namespace: "x/y/c2", title: "y", summary: "s" } });
    await db.docUnit.create({ data: { documentId: d1.id, ord: 0, groupTitle: null, title: "Old", contentCache: "o", walrusBlobId: "b", namespace: "x/y/c1" } });
    await db.docUnit.create({ data: { documentId: d2.id, ord: 0, groupTitle: null, title: "Step 1", contentCache: "a", walrusBlobId: "b", namespace: "x/y/c2" } });
    const detail = await getApplication("x", "y");
    expect(detail?.steps.map((s) => s.title)).toEqual(["Step 1"]);
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `pnpm --filter web test queries`
Expected: FAIL ("Cannot find module '@/lib/queries'").

- [ ] **Step 3: Implement queries**

`apps/web/src/lib/queries.ts`:
```ts
import { db } from "./db";

export async function listProtocols() {
  return db.protocol.findMany({ orderBy: { createdAt: "asc" }, select: { slug: true, name: true, description: true } });
}

async function latestDoc(entityId: string) {
  return db.document.findFirst({ where: { entityId }, orderBy: { version: "desc" } });
}

export async function getProtocol(slug: string) {
  const p = await db.protocol.findUnique({ where: { slug } });
  if (!p) return null;
  const latest = await latestDoc(p.id);
  const units = latest ? await db.docUnit.findMany({ where: { documentId: latest.id }, orderBy: { ord: "asc" } }) : [];

  // group by groupTitle preserving first-seen order
  const sections: { group: string; units: { title: string; content: string; blobId: string }[] }[] = [];
  for (const u of units) {
    const group = u.groupTitle ?? "DOCS";
    let sec = sections.find((s) => s.group === group);
    if (!sec) { sec = { group, units: [] }; sections.push(sec); }
    sec.units.push({ title: u.title, content: u.contentCache, blobId: u.walrusBlobId });
  }

  const showcaseRows = await db.showcaseEntry.findMany({
    where: { protocolId: p.id }, orderBy: { simplicityRank: "asc" }, include: { application: true },
  });
  const showcase = showcaseRows.map((r) => ({
    descriptiveTitle: r.descriptiveTitle, slug: r.application.slug, author: r.application.author, repo: r.application.repo,
  }));

  return { slug: p.slug, name: p.name, description: p.description, sections, showcase };
}

export async function getApplication(author: string, repo: string) {
  const slug = `${author}/${repo}`;
  const app = await db.application.findUnique({ where: { slug } });
  if (!app) return null;
  const latest = await latestDoc(app.id);
  const units = latest ? await db.docUnit.findMany({ where: { documentId: latest.id }, orderBy: { ord: "asc" } }) : [];
  const links = await db.applicationProtocol.findMany({ where: { applicationId: app.id }, include: { protocol: true } });
  return {
    slug, name: app.name, description: app.description,
    steps: units.map((u) => ({ title: u.title, content: u.contentCache, blobId: u.walrusBlobId })),
    protocols: links.map((l) => ({ slug: l.protocol.slug, name: l.protocol.name })),
  };
}
```

- [ ] **Step 4: Implement the routes**

`apps/web/src/app/api/protocols/route.ts`:
```ts
import { NextResponse } from "next/server";
import { listProtocols } from "@/lib/queries";
export async function GET() { return NextResponse.json(await listProtocols()); }
```

`apps/web/src/app/api/protocols/[slug]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getProtocol } from "@/lib/queries";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const d = await getProtocol(slug);
  return d ? NextResponse.json(d) : NextResponse.json({ error: "not found" }, { status: 404 });
}
```

`apps/web/src/app/api/applications/[author]/[repo]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getApplication } from "@/lib/queries";
export async function GET(_req: Request, ctx: { params: Promise<{ author: string; repo: string }> }) {
  const { author, repo } = await ctx.params;
  const d = await getApplication(author, repo);
  return d ? NextResponse.json(d) : NextResponse.json({ error: "not found" }, { status: 404 });
}
```

`apps/web/src/app/api/healthz/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getMemwal } from "@/lib/memwal";
import { db } from "@/lib/db";
export async function GET() {
  const out = { ok: true, relayer: "unknown", db: "unknown" as string };
  try { out.relayer = (await getMemwal().health()).status; } catch { out.relayer = "down"; out.ok = false; }
  try { await db.$queryRaw`SELECT 1`; out.db = "up"; } catch { out.db = "down"; out.ok = false; }
  return NextResponse.json(out, { status: out.ok ? 200 : 503 });
}
```

- [ ] **Step 5: Run it (passes)**

Run: `pnpm --filter web test queries`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add read queries + list/detail/healthz routes"
```

---

## Task 11: Browse UI (home chat + protocol sidebar + app steps)

**Files:**
- Create: `apps/web/src/app/page.tsx`, `apps/web/src/app/protocol/[slug]/page.tsx`, `apps/web/src/app/app/[author]/[repo]/page.tsx`, `apps/web/src/app/_components/ChatBox.tsx`, `apps/web/src/app/_components/AskBox.tsx`

**Interfaces:**
- Consumes: `listProtocols`, `getProtocol`, `getApplication` (Task 10); `/api/chat`, `/api/ask`.
- Produces: rendered pages. Verification = build + manual run.

- [ ] **Step 1: ChatBox + AskBox client components**

`apps/web/src/app/_components/ChatBox.tsx`:
```tsx
"use client";
import { useState } from "react";

export function ChatBox() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function ask() {
    setLoading(true); setAnswer(null);
    const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
    const json = await res.json();
    setAnswer(res.ok ? json.answer : `Error: ${json.error ?? "failed"}`);
    setLoading(false);
  }
  return (
    <div style={{ padding: 16, border: "2px solid #333", borderRadius: 8, marginBottom: 24 }}>
      <strong>Ask waldocs anything</strong>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="How do I store a blob on Walrus?" style={{ flex: 1, padding: 8 }} />
        <button onClick={ask} disabled={loading || !q}>{loading ? "…" : "Ask"}</button>
      </div>
      {answer && <p style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{answer}</p>}
    </div>
  );
}
```

`apps/web/src/app/_components/AskBox.tsx`:
```tsx
"use client";
import { useState } from "react";

export function AskBox({ entityType, slug }: { entityType: "protocol" | "application"; slug: string }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function ask() {
    setLoading(true); setAnswer(null);
    const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entityType, slug, question: q }) });
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

- [ ] **Step 2: Home page**

`apps/web/src/app/page.tsx`:
```tsx
import Link from "next/link";
import { listProtocols } from "@/lib/queries";
import { ChatBox } from "@/app/_components/ChatBox";

export const dynamic = "force-dynamic";

export default async function Home() {
  const protocols = await listProtocols();
  return (
    <main style={{ maxWidth: 820, margin: "2rem auto", fontFamily: "system-ui", padding: "0 1rem" }}>
      <h1>waldocs</h1>
      <ChatBox />
      <h2>Protocols</h2>
      <ul>
        {protocols.map((p) => (
          <li key={p.slug} style={{ marginBottom: 8 }}>
            <Link href={`/protocol/${p.slug}`}><strong>{p.name}</strong></Link>
            {p.description ? <div style={{ color: "#555" }}>{p.description}</div> : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: Protocol page (sidebar + showcase)**

`apps/web/src/app/protocol/[slug]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getProtocol } from "@/lib/queries";
import { AskBox } from "@/app/_components/AskBox";

export const dynamic = "force-dynamic";

export default async function ProtocolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await getProtocol(slug);
  if (!d) notFound();
  return (
    <main style={{ display: "flex", gap: 24, maxWidth: 1100, margin: "2rem auto", fontFamily: "system-ui", padding: "0 1rem" }}>
      <nav style={{ width: 240, flexShrink: 0, position: "sticky", top: 16, alignSelf: "flex-start" }}>
        <Link href="/">← waldocs</Link>
        {d.sections.map((s) => (
          <div key={s.group} style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#888" }}>{s.group}</div>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {s.units.map((u) => <li key={u.title}><a href={`#${encodeURIComponent(u.title)}`}>{u.title}</a></li>)}
            </ul>
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#888" }}>SHOWCASE</div>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {d.showcase.map((a) => <li key={a.slug}><Link href={`/app/${a.slug}`}>{a.descriptiveTitle}</Link></li>)}
          </ul>
        </div>
      </nav>
      <article style={{ flex: 1 }}>
        <h1>{d.name}</h1>
        {d.sections.map((s) => (
          <section key={s.group}>
            <h2 style={{ color: "#888", fontSize: 14 }}>{s.group}</h2>
            {s.units.map((u) => (
              <div key={u.title} id={encodeURIComponent(u.title)}>
                <h3>{u.title}</h3>
                <p style={{ whiteSpace: "pre-wrap" }}>{u.content}</p>
              </div>
            ))}
          </section>
        ))}
        <AskBox entityType="protocol" slug={slug} />
      </article>
    </main>
  );
}
```

- [ ] **Step 4: App page (ordered steps)**

`apps/web/src/app/app/[author]/[repo]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getApplication } from "@/lib/queries";
import { AskBox } from "@/app/_components/AskBox";

export const dynamic = "force-dynamic";

export default async function AppPage({ params }: { params: Promise<{ author: string; repo: string }> }) {
  const { author, repo } = await params;
  const d = await getApplication(author, repo);
  if (!d) notFound();
  return (
    <main style={{ maxWidth: 820, margin: "2rem auto", fontFamily: "system-ui", padding: "0 1rem" }}>
      <Link href="/">← waldocs</Link>
      <h1>{d.name} <small>(application)</small></h1>
      {d.protocols.length > 0 && (
        <p>Uses: {d.protocols.map((p) => <Link key={p.slug} href={`/protocol/${p.slug}`} style={{ marginRight: 8 }}>{p.name}</Link>)}</p>
      )}
      <ol>
        {d.steps.map((s) => (
          <li key={s.title} style={{ marginBottom: 16 }}>
            <strong>{s.title}</strong>
            <p style={{ whiteSpace: "pre-wrap" }}>{s.content}</p>
          </li>
        ))}
      </ol>
      <AskBox entityType="application" slug={d.slug} />
    </main>
  );
}
```

- [ ] **Step 5: Verify the build**

Run: `pnpm --filter web build`
Expected: build succeeds (routes + pages compile, no type errors).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add browse UI (home chat, protocol sidebar, app steps)"
```

---

## Task 12: One-time MemWal account bootstrap script

**Files:**
- Create: `scripts/seed-account.ts`

**Interfaces:**
- Consumes: `@mysten-incubation/memwal/account`.
- Produces: prints `MEMWAL_PRIVATE_KEY` + `MEMWAL_ACCOUNT_ID`.

- [ ] **Step 1: Implement the script**

`scripts/seed-account.ts`:
```ts
/**
 * One-time bootstrap (TESTNET). Requires OWNER_SUI_KEY (bech32 suiprivkey1...)
 * funded with testnet SUI. Run: pnpm seed:account  (loads apps/web/.env)
 */
import { generateDelegateKey, createAccount, addDelegateKey } from "@mysten-incubation/memwal/account";

const PKG = process.env.MEMWAL_PACKAGE_ID ?? "0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6";
const REG = process.env.MEMWAL_REGISTRY_ID ?? "0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437";

async function main() {
  const ownerKey = process.env.OWNER_SUI_KEY;
  if (!ownerKey) throw new Error("Set OWNER_SUI_KEY (bech32 suiprivkey1...) funded with testnet SUI.");

  const delegate = await generateDelegateKey();
  const account = await createAccount({ packageId: PKG, registryId: REG, suiPrivateKey: ownerKey, suiNetwork: "testnet" });
  await addDelegateKey({ packageId: PKG, accountId: account.accountId, publicKey: delegate.publicKey, label: "waldocs-backend", suiPrivateKey: ownerKey, suiNetwork: "testnet" });

  console.log("\n# Paste into apps/web/.env :");
  console.log(`MEMWAL_PRIVATE_KEY=${delegate.privateKey}`);
  console.log(`MEMWAL_ACCOUNT_ID=${account.accountId}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Verify the guard runs**

Run: `npx tsx scripts/seed-account.ts`
Expected: errors with "Set OWNER_SUI_KEY…" (confirms it loads + reaches the guard). With a funded `OWNER_SUI_KEY` in `apps/web/.env`, `pnpm seed:account` prints the two env lines.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add one-time testnet MemWal account bootstrap"
```

---

## Task 13: `waldocs-publish` Claude Code skill

**Files:**
- Create: `packages/skill/waldocs-publish/SKILL.md`

**Interfaces:**
- Consumes: `POST /api/publish` contract (Task 8 / spec §7.1).
- Produces: a skill that sends app step-by-step markdown.

- [ ] **Step 1: Implement the skill**

`packages/skill/waldocs-publish/SKILL.md`:
````markdown
---
name: waldocs-publish
description: Publish this app's step-by-step docs to the waldocs platform. Use when the user asks to publish docs to waldocs, share how this project uses a protocol, or contribute to waldocs.
---

# Publish to waldocs

You publish **this application's** step-by-step documentation to the waldocs backend. waldocs only accepts **applications**; the backend (Gemini) structures your markdown, merges useful knowledge into the protocols you used, and curates the showcase. You do NOT call Walrus Memory directly.

## Configuration
- Backend: `${WALDOCS_API_URL:-http://localhost:3000}`, endpoint `POST {base}/api/publish`.

## Steps

1. **Derive identity from git (never guess):**
   - `slug` = `<author>/<repo>` parsed from `git remote get-url origin` (strip host + `.git`). If there is no remote, ask the user for `author/repo`.
   - `commitHash` = `git rev-parse HEAD`.
   - `repoUrl` = the normalized `https://github.com/<author>/<repo>` URL.

2. **Write step-by-step markdown** describing how to build/use this project. Make it **modular**: each step is one self-contained action, and following the steps top-to-bottom must produce a working result. Prefer real commands and code from this repo.

3. **Determine `usesProtocols`:** lowercase slugs of the protocols this project integrates (e.g. `["walrus","sui","seal"]`), inferred from dependencies/imports/config. Use simple slugs, not repo paths.

4. **POST** the payload (the backend does all structuring/merging):

```bash
curl -sS -X POST "${WALDOCS_API_URL:-http://localhost:3000}/api/publish" \
  -H "content-type: application/json" \
  -d @- <<'JSON'
{
  "entity": {
    "type": "application",
    "slug": "<author>/<repo>",
    "name": "<short name>",
    "description": "<one line>",
    "repoUrl": "https://github.com/<author>/<repo>",
    "commitHash": "<git rev-parse HEAD>"
  },
  "markdown": "## Step 1: ...\n...\n## Step 2: ...\n...",
  "usesProtocols": ["walrus"]
}
JSON
```

5. **Report** the response: show `url`, `version`, the number of `blobIds` published, and `mergedProtocols` (which protocol docs your contribution improved). On a 400, show the validation `issues` and fix the payload (most often a bad `slug` — it must be `author/repo`).
````

- [ ] **Step 2: Verify frontmatter + structure**

Run: `node -e "const t=require('fs').readFileSync('packages/skill/waldocs-publish/SKILL.md','utf8'); if(!t.startsWith('---')||!/name:\\s*waldocs-publish/.test(t)) throw new Error('bad frontmatter'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Manual end-to-end (optional, needs running backend + seeded env)**

Install the skill (copy to `.claude/skills/waldocs-publish/` in a test repo), run it, then confirm the app page renders and the used protocol's page shows merged content + a showcase entry.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add waldocs-publish Claude Code skill"
```

---

## Self-Review

**Spec coverage (rev. 3):**
- App-only publish of markdown → Tasks 7, 8, 13. ✓
- Gemini structure/merge/curate/answer → Task 6; orchestrated in Tasks 7, 9. ✓
- Protocols as pure merge targets (stub on reference, whole-doc merge, improve-or-keep) → Task 7 (`upsertProtocolBySlug` + `mergeProtocolDoc` + conditional protocol document write). ✓
- Mandatory GETTING STARTED kept by Gemini → enforced in the `mergeProtocolDoc` prompt (Task 6); rendered by section grouping (Task 10/11). ✓
- App identity git `<author>/<repo>` + `<author>/<repo>/<commit>` namespace + author/repo columns → Tasks 2, 3, 7. ✓
- Showcase curated on publish, notable/simple-first/deduped/descriptive titles → Tasks 6, 7 (`curateShowcase` + `replaceShowcase`), rendered Task 10/11. ✓
- Home global chat (Gemini, two-stage, top≈3) + per-entity ask → Task 9; UI Task 11. ✓
- Protocol sidebar (GETTING STARTED → body → SHOWCASE) + app step page → Tasks 10, 11. ✓
- `_toc` discovery incl. slashed app slugs → Task 3 (regex allows `/`). ✓
- Testnet + staging relayer + seed script → Tasks 5, 12; env in `.env.example`. ✓

**Type consistency:** `MemwalPort`/`RepoPort`/`LlmPort`/`GroupedUnit`/`Step` defined in Task 3 and used identically in Tasks 4–11; `protocolNamespace`/`appNamespace`/`parseSlug` defined in Task 7 and reused in routes; `PublishResult` produced in Task 7 returned verbatim in Task 8; `curateShowcase` entry shape (`slug`,`descriptiveTitle`,`simplicityRank`,`clusterKey`) consistent across Tasks 3, 4, 6, 7. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Accepted risks (spec §12):** LLM latency/cost/nondeterminism (publish may take seconds; `maxDuration` raised), append-only Walrus, open endpoint. Not blockers for v1.
