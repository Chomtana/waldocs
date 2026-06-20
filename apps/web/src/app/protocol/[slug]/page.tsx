import { notFound } from "next/navigation";
import { getProtocol } from "@/lib/queries";
import { AskBox } from "@/app/_components/AskBox";
import { Markdown } from "@/app/_components/Markdown";
import { ProtocolSidebar } from "@/app/_components/ProtocolSidebar";

export const dynamic = "force-dynamic";

const anchor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default async function ProtocolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await getProtocol(slug);
  if (!d) notFound();
  return (
    <div className="docs-layout">
      <ProtocolSidebar slug={slug} sections={d.sections} showcase={d.showcase} />

      <article className="content">
        <h1 className="doc-title">
          {d.name} <small>protocol</small>
        </h1>
        {d.description ? <p className="uses">{d.description}</p> : null}
        {d.sections.flatMap((s) =>
          s.units.map((u) => (
            <section className="unit" id={anchor(u.title)} key={u.id}>
              <h3>{u.title}</h3>
              <Markdown>{u.content}</Markdown>
            </section>
          )),
        )}
        <AskBox entityType="protocol" slug={slug} />
      </article>
    </div>
  );
}
