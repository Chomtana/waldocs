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
          "following them top-to-bottom must work). PRESERVE every fenced code block / shell command from the source " +
          "verbatim inside its step — never collapse code into prose; each step should keep its concrete example. If the " +
          "source used a placeholder token or comment stub (PKG, OWNER, <your-key>, '// fill this in'), replace it with a " +
          "realistic MOCK value (real package@version, 0x-prefixed ids, suiprivkey1… keys, https URLs). If the markdown opens " +
          "with an '## Environment' block listing the protocols/SDKs/versions it was built against, KEEP it verbatim as the " +
          "FIRST step titled 'Environment'. Return a short human title, a 1-3 sentence summary, and the steps.\n\n" +
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
          `EXAMPLES ARE MANDATORY: every unit's content MUST contain at least one concrete, copy-pasteable fenced code block ` +
          "(```bash, ```ts, ```env, …) — a real command and/or code — never prose-only. Preserve real code from the app's steps " +
          `rather than describing it. Fill every example with realistic MOCK values (real package@version, 0x-prefixed object ids ` +
          `like 0x28bdd2e9…, suiprivkey1… keys, https URLs); NEVER use placeholder tokens (no PKG, REG, OWNER, <your-key>, "…") ` +
          `or comment stubs (no "// fill this in"). A reader must be able to copy a block and run it with only trivial substitution. ` +
          `The app's first step is usually an "Environment" block naming the SDK package(s) and exact versions it used. ` +
          `Treat that version info as authoritative: keep the protocol doc's code on the CURRENT, non-deprecated syntax for the ` +
          `newest SDK version you have seen across apps; if this app uses a newer version whose syntax supersedes a deprecated form ` +
          `in the current doc, UPDATE the doc to the new syntax and note the version it requires (record a known-good minimum ` +
          `SDK version in GETTING STARTED). ` +
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

function defaultGen(): Gen {
  // Route through Vercel AI Gateway (auth: AI_GATEWAY_API_KEY, or Vercel OIDC on deploy).
  // GEMINI_MODEL may be a bare model id (we prefix "google/") or a full
  // "<creator>/<model>" gateway slug (used verbatim).
  const m = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
  const model = gateway(m.includes("/") ? m : `google/${m}`);
  const raw: Gen = (args) => generateObject({ model, schema: args.schema, prompt: args.prompt });
  return withRetry(raw, 3);
}

let singleton: LlmPort | null = null;
export function getLlm(): LlmPort {
  if (!singleton) singleton = createLlm(defaultGen());
  return singleton;
}
