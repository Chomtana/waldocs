import { notFound } from "next/navigation";
import Link from "next/link";
import { getProtocol } from "@/lib/queries";
import { AskBox } from "@/app/_components/AskBox";
import { Markdown } from "@/app/_components/Markdown";

export const dynamic = "force-dynamic";

const anchor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default async function ProtocolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await getProtocol(slug);
  if (!d) notFound();
  return (
    <div className="docs-layout">
      <aside className="sidebar">
        {d.sections.map((s) => (
          <div className="group" key={s.group}>
            <div className="group-title">{s.group}</div>
            <ul>
              {s.units.map((u) => (
                <li key={u.id}>
                  <a href={`#${anchor(u.title)}`}>{u.title}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {d.showcase.length > 0 && (
          <div className="group">
            <div className="group-title">Showcase</div>
            <ul>
              {d.showcase.map((a) => (
                <li key={a.slug}>
                  <Link href={`/app/${a.slug}`}>{a.descriptiveTitle}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

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
