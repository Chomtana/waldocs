# waldocs — Demo Pitch Script

**One-liner:** *"Agent-readable protocol docs that build themselves, with examples and a showcase, from the apps that use them, on Walrus."*

**Total runtime:** ~2.5–3 minutes. Talk the idea while doing the demo — one continuous flow, no separate sections.

---

## 0:00 — Hook — 18s

> "Protocol docs have three problems that significantly hurt claude code and developer performance. First, some of them block Claude. Second, many don't have examples for every feature. And third, most have no showcase. So we took a thousand projects from past Sui hackathons and combined them into one self-improving doc that fixes all three, automatically. Let me show you."

---

## 0:18 — The idea, demonstrated live — 130s

*(Narrate naturally over the actions. Don't look back at the three points.)*

**[SHOW: terminal in a real Sui app repo — PredictFlow]**

> "The idea is simple. The developers who use a protocol are the ones creating the knowledge its docs are missing, so we harvest it. A developer finishes their app and runs one waldocs publish command in their repo."

**[TYPE]** `/waldocs-publish`

> "waldocs reads the repo, works out which protocols and SDK versions it uses, writes a step-by-step guide where every step has runnable code with real values, and then merges that knowledge into the docs of every protocol the app touched."

**[SHOW: the protocols list — `https://waldocs.vercel.app`]**

> "So here are the protocols we have, and these pages aren't hand-written. They're a thousand projects from past Sui hackathons, all combined together into one doc per protocol."

**[SHOW: open a protocol — `/protocol/deepbook` — scroll the sidebar and a code block]**

> "Open one and it's a clean docs site, with the sections grouped in the sidebar so you can jump straight to what you need, and every code block syntax-highlighted and ready to copy. And it just got better from the app we published, because waldocs routed each piece of that app to the one protocol it belongs to, so the mint call landed here in DeepBook, the payment logic went to Payment Kit, and the wallet connect went to Slush. The apps teach the protocols."

**[SHOW: the showcase on the protocol page]**

> "And down here is the showcase, the apps that actually use this protocol, and you can jump into any of them to see how they did it. You can click on PredictFlow and it will show you step by step document on how to implement this project and integrate with each Sui protocol."

**[SHOW: Claude Code — invoke the `waldocs-read` skill]**

> "And the best part, an agent can read all of this while it codes. Here in Claude Code I ask how to mint a prediction in Deepbook, and it calls the waldocs tool, pulls the exact protocol docs it needs, and loads them straight into its context."

---

## 2:28 — Close — 15s

> "So that's three problems, agent-blocked docs, missing examples, and no showcase, all fixed from a single command, and all stored on Walrus. A thousand past hackathon projects already feed it, and imagine every new app on Sui doing the same. That's waldocs."

---

## Appendix (reference, not spoken)

**15-second elevator:**
> "Protocol docs today block AI agents, miss examples for most features, and have no showcase. waldocs fixes all three automatically — publish your app's guide with one command, and waldocs merges that real-world knowledge, with runnable examples and a curated showcase, into every protocol the app used. On Walrus, semantically searchable, readable by any agent."

**Judge Q&A**
- **Merge quality** — existing units stay verbatim, a routing step sends each unit to the one protocol it belongs to, and content-hash dedup blocks duplicates in both Postgres and Walrus.
- **Why Walrus** — decentralized, verifiable, and native semantic recall; docs as a public good can't live in one company's database.
- **Abuse** — apps are keyed by git `author/repo` + commit, the merge only adds knowledge that improves a protocol, and reputation/curation gating is future work.
- **Is it just RAG over a wiki?** — No. The differentiator is automatic, routed back-propagation of knowledge from apps into protocol docs, on decentralized storage, readable by agents.

**Demo safety**
- **Pre-publish** the app before the demo — a full publish runs ~1.5–2 min on Walrus rate-limited writes; narrate over the already-published result rather than waiting live.
- **Pre-warm** every page (open each once) so Vercel cold starts don't hit you on stage.
- **Pre-run** the `waldocs-read` query in Claude Code once so the answer lands cleanly on stage.

**Demo flow / links**
1. Terminal in the app repo → `/waldocs-publish` (say it generates the guide + merges into protocol docs; don't open the app page).
2. Protocols list — https://waldocs.vercel.app
3. A protocol that got improved — https://waldocs.vercel.app/protocol/deepbook (sidebar + syntax highlighting + the routed merge), then its showcase.
4. Claude Code → `waldocs-read` query (the agent reads the docs).
