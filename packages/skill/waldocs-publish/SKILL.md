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

2. **Detect the protocols + SDKs + exact versions this project actually uses.** For each protocol the project integrates, find the SDK package(s) it imports and the **exact installed version** — read it from the **lockfile first** (`pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` / `Cargo.lock` / `poetry.lock` / `go.sum`), falling back to the manifest range (`package.json`, `Cargo.toml`, `pyproject.toml`, …). Capture language/runtime too (Node/TS, Rust, Python). This is the single most important signal for the backend: it lets the merge step keep the protocol's docs on current, non-deprecated syntax.

3. **Write step-by-step markdown** that **begins with an `## Environment` block**, then the modular steps:

   ```markdown
   ## Environment

   - walrus: `@mysten-incubation/memwal@0.0.7` (Node / TypeScript)
   - sui: `@mysten/sui@2.19.0`
   - seal: `@mysten/seal@1.4.0`

   > Exact SDK packages/versions this guide was written and verified against.

   ## Step 1: ...
   ...
   ## Step 2: ...
   ```

   Keep it **modular**: each step is one self-contained action, and following them top-to-bottom must produce a working result. **Every step MUST include at least one runnable fenced code block or shell command** (real commands/code from this repo) — never prose-only. Fill examples with realistic **mock values** (real `package@version`, `0x…` ids, `suiprivkey1…` keys, https URLs); never use placeholder tokens (`PKG`, `<your-key>`, `…`) or comment stubs (`// fill this in`). If you used a syntax/API that replaced a deprecated one, say so in the relevant step (e.g. "use `SuiJsonRpcClient`; the old `SuiClient` was removed in @mysten/sui 2.x").

4. **Determine `usesProtocols`:** lowercase slugs of the protocols this project integrates (e.g. `["walrus","sui","seal"]`), inferred from dependencies/imports/config. Use simple slugs, not repo paths. These must match the protocols named in your `## Environment` block.

5. **POST** the payload (the backend does all structuring/merging):

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
  "markdown": "## Environment\n\n- walrus: `@mysten-incubation/memwal@0.0.7` (Node / TypeScript)\n\n> Exact SDK versions this guide was verified against.\n\n## Step 1: ...\n...\n## Step 2: ...\n...",
  "usesProtocols": ["walrus"]
}
JSON
```

6. **Report** the response: show `url`, `version`, the number of `blobIds` published, and `mergedProtocols` (which protocol docs your contribution improved). On a 400, show the validation `issues` and fix the payload (most often a bad `slug` — it must be `author/repo`).
