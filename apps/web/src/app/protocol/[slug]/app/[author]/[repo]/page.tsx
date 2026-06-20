import { notFound } from "next/navigation";
import Link from "next/link";
import { getProtocol, getApplication } from "@/lib/queries";
import { AskBox } from "@/app/_components/AskBox";
import { Markdown } from "@/app/_components/Markdown";
import { ProtocolSidebar } from "@/app/_components/ProtocolSidebar";

export const dynamic = "force-dynamic";

const anchor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// Protocol-scoped app detail: keeps the protocol's sidebar (with this app
// highlighted in the showcase) while showing the app's doc in the content pane.
export default async function ProtocolAppPage({
  params,
}: {
  params: Promise<{ slug: string; author: string; repo: string }>;
}) {
  const { slug, author, repo } = await params;
  const [proto, app] = await Promise.all([getProtocol(slug), getApplication(author, repo)]);
  if (!proto || !app) notFound();
  const appSlug = `${author}/${repo}`;
  return (
    <div className="docs-layout">
      <ProtocolSidebar
        slug={slug}
        sections={proto.sections}
        showcase={proto.showcase}
        activeAppSlug={appSlug}
        sectionBase={`/protocol/${slug}`}
      />

      <article className="content">
        <p className="breadcrumb">
          <Link href={`/protocol/${slug}`}>← {proto.name}</Link> · Showcase
        </p>
        <h1 className="doc-title">
          {app.name} <small>application</small>
        </h1>
        {app.description ? <p className="uses">{app.description}</p> : null}
        {app.steps.map((s) => (
          <section className="unit" id={anchor(s.title)} key={s.id}>
            <h3>{s.title}</h3>
            <Markdown>{s.content}</Markdown>
          </section>
        ))}
        <AskBox entityType="application" slug={app.slug} />
      </article>
    </div>
  );
}
