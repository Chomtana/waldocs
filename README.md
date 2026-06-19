# waldocs

**A unified developer-docs platform where protocol docs improve themselves from real app usage.**

A contributor runs the `waldocs-publish` skill in their app repo; it sends the app's step-by-step markdown to the backend, which uses an LLM to:

1. **structure** the app doc,
2. **merge** useful knowledge into the docs of each protocol the app uses, and
3. **curate** a showcase of notable apps.

Docs are stored on **Walrus Memory** (decentralized, semantically searchable) and indexed in **Postgres**.

The counterpart `waldocs-read` skill pulls those curated docs + showcase back into an agent's context (context7-style) whenever you work on a Sui-ecosystem protocol — so the docs you wrote from real usage feed the next person's coding session.

## Layout

| Path | What |
|------|------|
| [`apps/web`](./apps/web) | Next.js app: the docs site + the backend API (`/api/publish`, `/api/protocols`, `/api/applications`, `/api/chat`, `/api/ask`). |
| [`packages/skill`](./packages/skill) | The `waldocs-read` and `waldocs-publish` Claude Code skills. |
| [`docs/superpowers`](./docs/superpowers) | Authoritative design specs + task history. |
| [`CLAUDE.md`](./CLAUDE.md) | Architecture and operational rules (the port pattern, publish pipeline, gotchas). |

## Run the backend

pnpm monorepo; everything runs through `apps/web`.

```bash
docker compose up -d db          # Postgres (required)
pnpm install
pnpm dev                         # next dev on :3000
```

Type-check with `pnpm --filter web exec tsc --noEmit` and test with `pnpm test`. See [CLAUDE.md](./CLAUDE.md) for the full command list and the critical operational rules (notably: never run `next build` while `next dev` is up).

## Install the skills

The skills are spec-compliant `SKILL.md` files ([Agent Skills spec](https://agentskills.io/specification)) — "installing" one means copying its directory to a place your agent scans. Both skills read `WALDOCS_API_URL` (default `http://localhost:3000`).

```bash
# Per project — make them available in any repo (use "." for this one)
TARGET=/path/to/your/repo
mkdir -p "$TARGET/.claude/skills"
cp -R packages/skill/waldocs-read    "$TARGET/.claude/skills/waldocs-read"
cp -R packages/skill/waldocs-publish "$TARGET/.claude/skills/waldocs-publish"

# Personal — make them available in all your projects
mkdir -p ~/.claude/skills
cp -R packages/skill/waldocs-read ~/.claude/skills/waldocs-read

# Point at a deployed backend if it isn't on localhost
export WALDOCS_API_URL=https://your-waldocs-deployment.example.com
```

Then trigger by intent (no slash command): ask *"how do I use Walrus with the memwal SDK?"* (read) or *"publish this app's docs to waldocs"* (publish). Full guide and other runtimes: [`packages/skill/README.md`](./packages/skill/README.md).
