import "server-only";
import { z } from "zod";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LlmPort } from "./types";

const stepSchema = z.object({ title: z.string(), content: z.string() });
const unitSchema = z.object({ group: z.string().nullable(), title: z.string(), content: z.string() });

const structureSchema = z.object({ name: z.string(), summary: z.string(), steps: z.array(stepSchema) });
const mergeSchema = z.object({
  changed: z.boolean(),
  doc: z.array(unitSchema).optional(),
  summary: z.string().optional(),
});
const describeSchema = z.object({ description: z.string() });
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
          "following them top-to-bottom must work). PRESERVE every fenced code block / shell command from the source " +
          "verbatim inside its step — never collapse code into prose; each step should keep its concrete example. If the " +
          "source used a placeholder token or comment stub (PKG, OWNER, <your-key>, '// fill this in'), replace it with a " +
          "realistic MOCK value (real package@version, 0x-prefixed ids, https URLs). REDACT SECRETS: never output a full " +
          "private key, API key, mnemonic, or user-specific account/wallet id — truncate them to a recognizable form like " +
          "0x28bd…508b or suiprivkey1qz…3w8 (public constants like package@version, well-known contract object ids, and URLs " +
          "stay full). If the markdown opens " +
          "with an '## Environment' block listing the protocols/SDKs/versions it was built against, KEEP it verbatim as the " +
          "FIRST step titled 'Environment'. Return a short human title, a 1-3 sentence summary, and the steps.\n\n" +
          markdown,
      });
      return object;
    },
    async describeProtocol({ protocolName, doc }) {
      const { object } = await gen({
        schema: describeSchema,
        prompt:
          `In ONE concise sentence, define what the developer protocol/technology named "${protocolName}" IS and does, ` +
          `for a docs-index card. Rely on your OWN knowledge of what "${protocolName}" is in the Sui/Walrus ecosystem ` +
          `(e.g. Sui = a Layer-1 blockchain; Seal = threshold encryption / on-chain access control & decentralized secrets management; ` +
          `Walrus = decentralized blob storage). IGNORE the doc excerpts if they describe a DIFFERENT technology that merely uses ` +
          `"${protocolName}" — they are often written from an app's perspective and will mislead you; use them only as a tie-breaker ` +
          `when the name alone is genuinely ambiguous. Output ONLY the definition: no changelog, no "Changes:"/"Added", no mention ` +
          `of any app, no version notes. Shape it as "<Name> is a <category> that <does X>."\n\n` +
          `DOC_EXCERPTS (may be misleading — see above):\n${JSON.stringify(doc.slice(0, 4))}`,
      });
      return object;
    },
    async mergeProtocolDoc({ protocolName, currentDoc, appName, appSteps }) {
      const { object } = await gen({
        schema: mergeSchema,
        prompt:
          `You maintain the developer docs for the protocol "${protocolName}". The doc is an ordered list of units, ` +
          `each with a sidebar group, and MUST keep a "GETTING STARTED" group containing units titled "Introduction" and "Getting Started". ` +
          `EXAMPLES ARE MANDATORY: every unit's content MUST contain at least one concrete, copy-pasteable fenced code block ` +
          "(```bash, ```ts, ```env, …) — a real command and/or code — never prose-only. Preserve real code from the app's steps " +
          `rather than describing it. Fill every example with realistic MOCK values (real package@version, 0x-prefixed object ids ` +
          `like 0x28bdd2e9…, https URLs); NEVER use placeholder tokens (no PKG, REG, OWNER, <your-key>, "…") ` +
          `or comment stubs (no "// fill this in"). REDACT SECRETS: never output a full private key, API key, mnemonic, or ` +
          `user-specific account/wallet id — truncate them to a recognizable form like 0x28bd…508b or suiprivkey1qz…3w8 ` +
          `(public constants like package@version, well-known contract/registry object ids, and URLs stay full). ` +
          `A reader must be able to copy a block and run it with only trivial substitution. ` +
          `The app's first step is usually an "Environment" block naming the SDK package(s) and exact versions it used. ` +
          `Treat that version info as authoritative: keep the protocol doc's code on the CURRENT, non-deprecated syntax for the ` +
          `newest SDK version you have seen across apps; if this app uses a newer version whose syntax supersedes a deprecated form ` +
          `in the current doc, UPDATE the doc to the new syntax and note the version it requires (record a known-good minimum ` +
          `SDK version in GETTING STARTED). ` +
          `"summary" is a 1-3 sentence overview of the "${protocolName}" protocol's documentation for discovery — it describes ` +
          `the protocol itself, NOT this app and NOT the edits you made; never write phrasing like "Changes:", "Added", "Moved", ` +
          `or "The <app> app demonstrates…". ` +
          `Given the current doc and a new app's experience, return changed=true with the FULL improved doc ONLY if the app genuinely ` +
          `improves it (new feature coverage, clearer steps, or a deprecation fix); otherwise return changed=false.\n\n` +
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

// Weaker models intermittently fail generateObject's schema validation
// ("No object generated"). Retry the call up to `attempts` times before giving up.
export function withRetry(gen: Gen, attempts = 3): Gen {
  return async (args) => {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await gen(args);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  };
}

function extractJson(text: string): unknown {
  // Slice the outermost { … } — robust to surrounding prose/code fences and to
  // ```bash/```ts blocks embedded inside the JSON string values (don't fence-strip).
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model response");
  return JSON.parse(text.slice(start, end + 1));
}

// Pick the generation model. If ANTHROPIC_API_KEY is set, prefer Claude
// (CLAUDE_MODEL, default a fast Haiku); otherwise route through OpenRouter
// (OPENROUTER_API_KEY + GEMINI_MODEL slug). Both speak the same generateText
// interface, so the JSON-schema-in-prompt path below is provider-agnostic.
function buildModel() {
  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return anthropic(process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001");
  }
  const openrouter = createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
  });
  return openrouter(process.env.GEMINI_MODEL ?? "google/gemini-2.5-flash-lite");
}

function defaultGen(): Gen {
  const model = buildModel();
  // Provider-agnostic structured output: send the JSON Schema in the prompt,
  // then extract + zod-validate the reply. More reliable across OpenRouter
  // models than depending on each provider's native structured-output mode.
  const raw: Gen = async (args) => {
    const jsonSchema = JSON.stringify(zodToJsonSchema(args.schema));
    const { text } = await generateText({
      model,
      prompt:
        `${args.prompt}\n\nReturn ONLY a single JSON object — no markdown, no code fences, no commentary — ` +
        `that strictly conforms to this JSON Schema:\n${jsonSchema}`,
    });
    const object = args.schema.parse(extractJson(text));
    return { object };
  };
  return withRetry(raw, 3);
}

let singleton: LlmPort | null = null;
export function getLlm(): LlmPort {
  if (!singleton) singleton = createLlm(defaultGen());
  return singleton;
}
