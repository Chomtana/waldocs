import { notFound } from "next/navigation";
import Link from "next/link";
import { getApplication } from "@/lib/queries";
import { AskBox } from "@/app/_components/AskBox";
import { Markdown } from "@/app/_components/Markdown";

export const dynamic = "force-dynamic";

const anchor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default async function AppPage({ params }: { params: Promise<{ author: string; repo: string }> }) {
  const { author, repo } = await params;
  const d = await getApplication(author, repo);
  if (!d) notFound();
  return (
    <div className="docs-layout">
      <aside className="sidebar">
        <div className="group">
          <div className="group-title">Steps</div>
          <ul>
            {d.steps.map((s) => (
              <li key={s.id}>
                <a href={`#${anchor(s.title)}`}>{s.title}</a>
              </li>
            ))}
          </ul>
        </div>
        {d.protocols.length > 0 && (
          <div className="group">
            <div className="group-title">Uses</div>
            <ul>
              {d.protocols.map((p) => (
                <li key={p.slug}>
                  <Link href={`/protocol/${p.slug}`}>{p.name}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <article className="content">
        <h1 className="doc-title">
          {d.name} <small>application</small>
        </h1>
        {d.description ? <p className="uses">{d.description}</p> : null}
        {d.steps.map((s) => (
          <section className="unit" id={anchor(s.title)} key={s.id}>
            <h3>{s.title}</h3>
            <Markdown>{s.content}</Markdown>
          </section>
        ))}
        <AskBox entityType="application" slug={d.slug} />
      </article>
    </div>
  );
}
