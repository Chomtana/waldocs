export type EntityType = "protocol" | "application";

export interface GroupedUnit { group: string | null; title: string; content: string }
export interface Step { title: string; content: string }

export interface PublishInput {
  entity: {
    type: "application";
    slug: string;            // "<author>/<repo>"
    name?: string;
    description?: string;
    repoUrl?: string;
    commitHash: string;
  };
  markdown: string;
  usesProtocols: string[];
}

export interface PublishResult {
  url: string;
  slug: string;
  documentId: string;
  version: number;
  namespace: string;
  blobIds: string[];
  tocBlobId: string;
  mergedProtocols: { slug: string; changed: boolean }[];
}

export interface MemwalPort {
  remember(text: string, namespace: string): Promise<{ blobId: string }>;
  recall(
    query: string,
    namespace: string,
    opts?: { limit?: number; maxDistance?: number },
  ): Promise<{ results: { blobId: string; text: string; distance: number }[] }>;
  health(): Promise<{ status: string }>;
}

export interface LlmPort {
  structureAppDoc(markdown: string): Promise<{ name: string; summary: string; steps: Step[] }>;
  mergeProtocolDoc(args: {
    protocolName: string;
    currentDoc: GroupedUnit[];
    appName: string;
    appSteps: Step[];
  }): Promise<{ changed: boolean; doc?: GroupedUnit[]; summary?: string; description?: string }>;
  curateShowcase(args: {
    protocolName: string;
    candidates: { slug: string; name: string; summary: string }[];
  }): Promise<{ entries: { slug: string; descriptiveTitle: string; simplicityRank: number; clusterKey: string }[] }>;
  answerOverContext(args: {
    question: string;
    context: { label: string; text: string }[];
  }): Promise<{ answer: string; usedLabels: string[] }>;
}

export interface UpsertProtocolArgs { slug: string; name: string; description?: string; namespace: string }
export interface UpsertAppArgs {
  slug: string; author: string; repo: string; name: string;
  description?: string; namespace: string; latestCommit: string; repoUrl?: string;
}
export interface InsertUnitArgs {
  documentId: string; ord: number; groupTitle: string | null;
  title: string; contentCache: string; walrusBlobId: string; namespace: string;
}

export interface RepoPort {
  upsertProtocolBySlug(args: UpsertProtocolArgs): Promise<{ id: string }>;
  upsertApplication(args: UpsertAppArgs): Promise<{ id: string }>;
  linkAppProtocol(applicationId: string, protocolId: string): Promise<void>;
  nextVersion(entityId: string): Promise<number>;
  createDocument(args: {
    entityType: EntityType; entityId: string; version: number; commitHash?: string;
    namespace: string; title: string; summary: string; sourceMarkdown?: string;
  }): Promise<{ id: string }>;
  insertUnit(args: InsertUnitArgs): Promise<void>;
  setEntityToc(entityType: EntityType, entityId: string, tocBlobId: string): Promise<void>;
  setProtocolDescription(protocolId: string, description: string): Promise<void>;
  latestProtocolUnits(protocolId: string): Promise<GroupedUnit[]>;
  linkedApps(protocolId: string): Promise<{ id: string; slug: string; name: string; summary: string }[]>;
  replaceShowcase(
    protocolId: string,
    entries: { slug: string; descriptiveTitle: string; simplicityRank: number; clusterKey: string }[],
  ): Promise<void>;
  insertPublishEvent(args: { entityType: EntityType; entityId: string; documentId: string; meta?: unknown }): Promise<void>;
}
