import "server-only";
import { z } from "zod";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
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
  const model = google(process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite");
  return (args) => generateObject({ model, schema: args.schema, prompt: args.prompt });
}

let singleton: LlmPort | null = null;
export function getLlm(): LlmPort {
  if (!singleton) singleton = createLlm(defaultGen());
  return singleton;
}
