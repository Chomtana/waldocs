import { db } from "./db";

export async function listProtocols() {
  return db.protocol.findMany({ orderBy: { createdAt: "asc" }, select: { slug: true, name: true, description: true } });
}

async function latestDoc(entityId: string) {
  return db.document.findFirst({ where: { entityId }, orderBy: { version: "desc" } });
}

export async function getProtocol(slug: string) {
  const p = await db.protocol.findUnique({ where: { slug } });
  if (!p) return null;
  const latest = await latestDoc(p.id);
  const units = latest ? await db.docUnit.findMany({ where: { documentId: latest.id }, orderBy: { ord: "asc" } }) : [];

  // group by groupTitle preserving first-seen order
  const sections: { group: string; units: { id: string; title: string; content: string; blobId: string | null }[] }[] = [];
  for (const u of units) {
    const group = u.groupTitle ?? "DOCS";
    let sec = sections.find((s) => s.group === group);
    if (!sec) { sec = { group, units: [] }; sections.push(sec); }
    sec.units.push({ id: u.id, title: u.title, content: u.contentCache, blobId: u.walrusBlobId });
  }

  const showcaseRows = await db.showcaseEntry.findMany({
    where: { protocolId: p.id }, orderBy: { simplicityRank: "asc" }, include: { application: true },
  });
  let showcase = showcaseRows.map((r) => ({
    descriptiveTitle: r.descriptiveTitle, name: r.application.name,
    slug: r.application.slug, author: r.application.author, repo: r.application.repo,
  }));

  // Fallback: apps added via manual import only LINK to protocols (no curated
  // ShowcaseEntry rows). When nothing is curated, list every linked app from
  // ApplicationProtocol, ordered by when the app was created.
  if (showcase.length === 0) {
    const links = await db.applicationProtocol.findMany({
      where: { protocolId: p.id },
      include: { application: true },
      orderBy: { application: { createdAt: "asc" } },
    });
    showcase = links.map((l) => ({
      descriptiveTitle: l.application.description ?? l.application.name, name: l.application.name,
      slug: l.application.slug, author: l.application.author, repo: l.application.repo,
    }));
  }

  return { slug: p.slug, name: p.name, description: p.description, sections, showcase };
}

export async function getApplication(author: string, repo: string) {
  const slug = `${author}/${repo}`;
  const app = await db.application.findUnique({ where: { slug } });
  if (!app) return null;
  const latest = await latestDoc(app.id);
  const units = latest ? await db.docUnit.findMany({ where: { documentId: latest.id }, orderBy: { ord: "asc" } }) : [];
  const links = await db.applicationProtocol.findMany({ where: { applicationId: app.id }, include: { protocol: true } });
  return {
    slug, name: app.name, description: app.description,
    steps: units.map((u) => ({ id: u.id, title: u.title, content: u.contentCache, blobId: u.walrusBlobId })),
    protocols: links.map((l) => ({ slug: l.protocol.slug, name: l.protocol.name })),
  };
}
