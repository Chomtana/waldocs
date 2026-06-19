# waldocs skills

Two Claude Code skills for the [waldocs](../../CLAUDE.md) platform. They follow the open [Agent Skills spec](https://agentskills.io/specification) (a `SKILL.md` with `name` + `description` frontmatter), so they work in Claude Code and any other agent runtime that loads skills.

| Skill | Direction | What it does |
|-------|-----------|--------------|
| [`waldocs-read`](./waldocs-read/SKILL.md) | read | Resolves a Sui-ecosystem protocol slug and pulls its curated docs + app showcase into the agent's context (context7-style). Triggers when you work on Walrus/Sui/Seal/Deepbook/SuiNS or mention waldocs. |
| [`waldocs-publish`](./waldocs-publish/SKILL.md) | write | Publishes this app's step-by-step docs to the waldocs backend, which structures them and merges knowledge back into each protocol's docs. |

Both talk **only to the waldocs backend HTTP API** (never to Walrus Memory directly), so the only configuration is the backend URL.

## Install

A skill is just its directory (`SKILL.md` + any support files). "Installing" it = copying that directory to a location your agent scans. Pick a scope:

### Per project (recommended)

Make the skills available in one repo — yours or any other you work in:

```bash
# from this repo; TARGET = the repo you want the skills in (use "." for this one)
TARGET=/path/to/your/repo
mkdir -p "$TARGET/.claude/skills"
cp -R packages/skill/waldocs-read    "$TARGET/.claude/skills/waldocs-read"
cp -R packages/skill/waldocs-publish "$TARGET/.claude/skills/waldocs-publish"
```

### Personal (all your projects)

Install once for every project on your machine:

```bash
mkdir -p ~/.claude/skills
cp -R packages/skill/waldocs-read    ~/.claude/skills/waldocs-read
cp -R packages/skill/waldocs-publish ~/.claude/skills/waldocs-publish
```

### Other agent runtimes

Because these are spec-compliant `SKILL.md` files, the same copy works for runtimes that read the cross-runtime alias `~/.agents/skills/` (Codex, Copilot CLI, Gemini CLI), e.g. `cp -R packages/skill/waldocs-read ~/.agents/skills/waldocs-read`. Check your runtime's docs for its skills directory.

> Symlinking instead of copying (`ln -s "$PWD/packages/skill/waldocs-read" ~/.claude/skills/waldocs-read`) keeps the installed copy in sync with this repo while you iterate.

## Configure the backend URL

Both skills read `WALDOCS_API_URL`, defaulting to `http://localhost:3000`. Point them at a running backend if it lives elsewhere:

```bash
export WALDOCS_API_URL=https://your-waldocs-deployment.example.com
```

For local development, start the backend first (`pnpm dev` from the repo root) and the default is correct.

## Verify

Start a session in the target project and trigger by intent — there's no slash command to type:

- **read:** ask something like *"how do I use Walrus with the memwal SDK?"* or *"show me waldocs apps that use Sui"*. The agent should `GET /api/protocols`, resolve a slug, and read the docs.
- **publish:** ask *"publish this app's docs to waldocs"*. The agent should derive `author/repo` from git and `POST /api/publish`.

If a skill doesn't fire, confirm the directory landed at `.claude/skills/<name>/SKILL.md` and that the backend at `WALDOCS_API_URL` is reachable (`curl "$WALDOCS_API_URL/api/protocols"`).
