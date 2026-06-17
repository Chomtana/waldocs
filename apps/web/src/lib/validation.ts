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
