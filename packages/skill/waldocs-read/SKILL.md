---
name: waldocs-read
description: Use when working on a Sui-ecosystem protocol (Walrus, Sui, Seal, Deepbook, SuiNS, …) — reading or writing code that imports their SDKs — or when the user mentions waldocs, asks how one of these protocols works, or wants real example apps. Fetches the protocol's curated docs and app showcase from the waldocs backend into context.
---

# Read from waldocs

Pull **curated protocol docs and the app showcase** from the waldocs backend and read them into your own context, then ground your code and answers in them. waldocs docs are improved from real app usage, so they track current (non-deprecated) SDK syntax and link to working example apps.

**You read the docs; you do the reasoning.** Fetch the raw docs into context and answer/code yourself — do NOT delegate questions to a backend `/api/ask` or `/api/chat`. Use only the read (GET) endpoints below.

This works **like context7**: first resolve an id (`GET /api/protocols` ≈ `resolve-library-id`), then pull the raw docs into context (`GET /api/protocols/{slug}` ≈ `get-library-docs`) and let your own model reason over them.

## When to use

- The project depends on / imports a Sui-ecosystem SDK (`@mysten/sui`, `@mysten-incubation/memwal` for Walrus, `@mysten/seal`, Deepbook, SuiNS, …) and you need to write or review integration code.
- The user asks how a Sui protocol works, what the current API/syntax is, or for example apps that use it.
- The user mentions **waldocs** explicitly.

## Configuration

- Backend base: `${WALDOCS_API_URL:-http://localhost:3000}`. All endpoints below are **read-only GETs** — never call `POST /api/publish`.

## Steps

1. **Resolve the protocol slug (never guess it).** List what's published and match the protocol(s) in play to a real `slug`:

   ```bash
   curl -sS "${WALDOCS_API_URL:-http://localhost:3000}/api/protocols"
   # → [{ "slug": "walrus", "name": "Walrus", "description": "…" }, …]
   ```

   Map the SDKs/imports you see to a slug (e.g. `@mysten-incubation/memwal` → `walrus`, `@mysten/sui` → `sui`, `@mysten/seal` → `seal`). If no slug matches, **show the user the available protocols** instead of inventing one.

2. **Fetch the protocol doc + showcase** for each relevant slug:

   ```bash
   curl -sS "${WALDOCS_API_URL:-http://localhost:3000}/api/protocols/walrus"
   ```

   Response shape:

   ```json
   {
     "slug": "walrus", "name": "Walrus", "description": "…",
     "sections": [{ "group": "DOCS", "units": [{ "title": "…", "content": "<markdown>", "blobId": "…" }] }],
     "showcase": [{ "descriptiveTitle": "…", "slug": "author/repo", "author": "author", "repo": "repo" }]
   }
   ```

   Read every `units[].content` (markdown) into context — that's the doc. `showcase[]` is the curated list of notable apps that use the protocol.

3. **Read a showcase app's full steps** when you want a concrete, end-to-end integration example:

   ```bash
   curl -sS "${WALDOCS_API_URL:-http://localhost:3000}/api/applications/<author>/<repo>"
   # → { slug, name, description, steps: [{ title, content, blobId }], protocols: [{ slug, name }] }
   ```

4. **Ground your work in the docs.** Use the fetched `content` to write/correct code and answer the user. Prefer the doc's current syntax over your priors (it's maintained against real, recent SDK versions). When you rely on a doc unit or a showcase app, **cite it** (protocol name + the showcase app's `slug`) so the user can trace it.

## Notes

- Everything waldocs serves is **testnet** docs — say so when version/network matters.
- Read-only: this skill never publishes. To contribute docs back, that's the separate `waldocs-publish` skill.
- If the backend is unreachable or returns 404 for a slug, tell the user and fall back to the protocol's own SDK source/docs — don't fabricate API surface.
