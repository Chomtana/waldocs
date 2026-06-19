import { notFound } from "next/navigation";
import Link from "next/link";
import { getApplication } from "@/lib/queries";
import { AskBox } from "@/app/_components/AskBox";
import { Markdown } from "@/app/_components/Markdown";

export const dynamic = "force-dynamic";

export default async function AppPage({ params }: { params: Promise<{ author: string; repo: string }> }) {
  const { author, repo } = await params;
  const d = await getApplication(author, repo);
  if (!d) notFound();
  return (
    <main className="container">
      <h1 className="doc-title">
        {d.name} <small>application</small>
      </h1>
      {d.protocols.length > 0 && (
        <p className="uses">
          Uses:{" "}
          {d.protocols.map((p, i) => (
            <span key={p.slug}>
              {i > 0 ? ", " : ""}
              <Link href={`/protocol/${p.slug}`}>{p.name}</Link>
            </span>
          ))}
        </p>
      )}
      {d.steps.map((s) => (
        <section className="unit" key={s.id}>
          <h3>{s.title}</h3>
          <Markdown>{s.content}</Markdown>
        </section>
      ))}
      <AskBox entityType="application" slug={d.slug} />
    </main>
  );
}
