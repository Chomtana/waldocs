import { notFound } from "next/navigation";
import Link from "next/link";
import { getApplication } from "@/lib/queries";
import { AskBox } from "@/app/_components/AskBox";

export const dynamic = "force-dynamic";

export default async function AppPage({ params }: { params: Promise<{ author: string; repo: string }> }) {
  const { author, repo } = await params;
  const d = await getApplication(author, repo);
  if (!d) notFound();
  return (
    <main style={{ maxWidth: 820, margin: "2rem auto", fontFamily: "system-ui", padding: "0 1rem" }}>
      <Link href="/">← waldocs</Link>
      <h1>{d.name} <small>(application)</small></h1>
      {d.protocols.length > 0 && (
        <p>Uses: {d.protocols.map((p) => <Link key={p.slug} href={`/protocol/${p.slug}`} style={{ marginRight: 8 }}>{p.name}</Link>)}</p>
      )}
      <ol>
        {d.steps.map((s) => (
          <li key={s.title} style={{ marginBottom: 16 }}>
            <strong>{s.title}</strong>
            <p style={{ whiteSpace: "pre-wrap" }}>{s.content}</p>
          </li>
        ))}
      </ol>
      <AskBox entityType="application" slug={d.slug} />
    </main>
  );
}
