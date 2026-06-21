---
name: waldocs-import
description: Use when the user wants to manually upload/import a hand-authored protocol doc OR application doc directly into waldocs (the publish-bypass). Unlike waldocs-publish, this writes the doc verbatim — no LLM structuring, merging, or routing. Use for seeding protocol docs, bulk-loading docs you already wrote, or fixing a doc by hand.
---

# Import to waldocs (publish-bypass)

Write a **protocol** OR **application** doc *directly* to the waldocs backend (Postgres + Walrus), skipping the LLM structure/merge/route pipeline. The doc is stored **as you provide it**.

**When to use this vs `waldocs-publish`:**
- `waldocs-publish` — an app contributes its experience and the backend (LLM) structures it and **merges** knowledge into each protocol's docs. Use when publishing a real app's usage.
- `waldocs-import` (this) — you already have a finished doc and want it stored verbatim. No LLM, no merge, no routing. Use to **seed/replace protocol docs** or bulk-load hand-authored docs.

## Configuration

- Backend: `${WALDOCS_API_URL:-https://waldocs.vercel.app}`, endpoint `POST {base}/api/import`.
- **Auth (required):** the endpoint is gated by a shared token. Send `Authorization: Bearer ${WALDOCS_IMPORT_TOKEN}`. If `WALDOCS_IMPORT_TOKEN` is unset on the **server**, the endpoint is disabled (returns `503`). Ask the user for the token if you don't have one.

## Payload

```jsonc
{
  "entity": { /* one of: */
    // protocol:
    "type": "protocol", "slug": "walrus", "name": "Walrus", "description": "<one line: what this protocol is>"
    // OR application:
    // "type": "application", "slug": "<author>/<repo>", "name": "<short name>",
    // "description": "<one line>", "repoUrl": "https://github.com/<author>/<repo>", "commitHash": "<git rev-parse HEAD>"
  },
  "markdown": "<full markdown doc>",        // EITHER this …
  "units": [ { "group": "Getting Started", "title": "Install", "content": "```bash\n…\n```" } ], // … OR explicit units
  "usesProtocols": ["sui", "walrus"]        // application only — LINKS protocols (showcase); does NOT merge
}
```

Provide **`markdown`** (split automatically) **or** **`units`** (exact control) — at least one. `units` wins if both are given.

### How `markdown` is split into units (when you don't pass `units`)

- **protocol:** `##` headings = sidebar **groups**, `###` headings = **units**; text directly under a `##` (before its first `###`) becomes an intro unit; the doc preamble (the `# Title` + one-line definition) becomes an **"Introduction"** unit in the first group. So author protocol docs as `# Name` → definition → `## Group` → `### Unit` with code.
- **application:** each `##` heading = one step/unit (no groups). Author as `# Name` → `> desc` → `## Step 1: …`.

A leading `# Title` line is always dropped (the entity `name` is the title).

## Steps

1. **Decide the entity type and identity.**
   - **protocol** → `slug` is a lowercase `[a-z0-9-]+` (e.g. `walrus`, `sui`, `payment-kit`). Pick or confirm the slug with the user; check existing slugs first with `GET ${WALDOCS_API_URL:-https://waldocs.vercel.app}/api/protocols` to avoid creating a near-duplicate.
   - **application** → `slug` = `<author>/<repo>` from `git remote get-url origin`; `commitHash` = `git rev-parse HEAD`; `repoUrl` = `https://github.com/<author>/<repo>`.

2. **Prepare the doc.** Whether `markdown` or `units`, every unit MUST contain at least one **runnable** fenced code block / shell command with realistic **mock values** (real `package@version`, `0x…` ids, https URLs) — never placeholder tokens (`PKG`, `<your-key>`, `…`) or comment stubs. **Redact secrets** (private keys, API keys, mnemonics, user-specific account/wallet ids) to a truncated form like `0x28bd…508b` or `suiprivkey1qz…3w8`. For a protocol doc, start with a `## Getting Started` group (install + min SDK version) and keep code on **current, non-deprecated** syntax.

3. **POST** the payload:

```bash
curl -sS -X POST "${WALDOCS_API_URL:-https://waldocs.vercel.app}/api/import" \
  -H "authorization: Bearer ${WALDOCS_IMPORT_TOKEN}" \
  -H "content-type: application/json" \
  -d @- <<'JSON'
{
  "entity": { "type": "protocol", "slug": "walrus", "name": "Walrus", "description": "Walrus is a decentralized blob-storage network on Sui." },
  "markdown": "# Walrus\n\nWalrus is decentralized blob storage.\n\n## Getting Started\n\n### Install\n\n```bash\npnpm add @mysten/walrus@0.6.4\n```\n\n## Writing Blobs\n\n### Write a blob\n\n```ts\nconst { blobId } = await walrus.writeBlob({ blob: bytes, deletable: false, epochs: 3 });\n```\n"
}
JSON
```

   To bulk-import many docs (e.g. a folder of protocol docs), loop and POST each file's markdown one at a time.

4. **Report** the response: `url`, `entityType`, `version`, and `unitsWritten` (units written to Walrus + Postgres — they certify on Walrus in the background; pages render immediately from the cache). For applications, also note the linked `usesProtocols`.

## Errors

- **503** `import disabled` → the server has no `WALDOCS_IMPORT_TOKEN` set. Tell the user to set it (Vercel env) and redeploy.
- **401** `unauthorized` → wrong/missing `Authorization: Bearer` token.
- **400** `invalid payload` → show the validation `issues`. Most common: bad `slug` (protocol must be `[a-z0-9-]+`, application must be `author/repo`), or neither `units` nor non-empty `markdown` supplied.

## Notes

- Re-importing the **same** protocol/app reuses its document and **dedupes by content** — unchanged units are not re-written to Walrus (idempotent). Editing a unit's text writes the new version.
- Import only **links** an application to `usesProtocols`; it never improves those protocol docs from the app. To get the self-improving merge, use `waldocs-publish` instead.
- Everything is **testnet** docs — keep that in the content where version/network matters.
