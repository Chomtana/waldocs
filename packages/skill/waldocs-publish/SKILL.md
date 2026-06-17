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
