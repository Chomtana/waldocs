import { z } from "zod";

const protoSlug = z.string().regex(/^[a-z0-9-]+$/);
const appSlug = z.string().regex(/^[^/]+\/[^/]+$/, "slug must be author/repo");

export const publishSchema = z.object({
  entity: z.object({
    type: z.literal("application"),
    slug: appSlug,
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    repoUrl: z.string().url().optional(),
    commitHash: z.string().min(1),
  }),
  markdown: z.string().min(1),
  usesProtocols: z.array(protoSlug).default([]),
});
export type PublishBody = z.infer<typeof publishSchema>;

// Manual import (publish-bypass): submit a protocol OR application doc directly.
const importUnit = z.object({
  group: z.string().nullable().optional(),
  title: z.string().min(1),
  content: z.string().min(1),
});
export const importSchema = z
  .object({
    entity: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("protocol"),
        slug: protoSlug,
        name: z.string().min(1).optional(),
        description: z.string().optional(),
      }),
      z.object({
        type: z.literal("application"),
        slug: appSlug,
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        repoUrl: z.string().url().optional(),
        commitHash: z.string().min(1),
      }),
    ]),
    markdown: z.string().optional(),
    units: z.array(importUnit).optional(),
    usesProtocols: z.array(protoSlug).default([]),
  })
  .refine((d) => (d.units?.length ?? 0) > 0 || (d.markdown?.trim().length ?? 0) > 0, {
    message: "provide non-empty `units` or `markdown`",
  });
export type ImportBody = z.infer<typeof importSchema>;
