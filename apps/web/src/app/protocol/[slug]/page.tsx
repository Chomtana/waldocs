import { notFound } from "next/navigation";
import Link from "next/link";
import { getProtocol } from "@/lib/queries";
import { AskBox } from "@/app/_components/AskBox";

export const dynamic = "force-dynamic";

export default async function ProtocolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await getProtocol(slug);
  if (!d) notFound();
  return (
    <main style={{ display: "flex", gap: 24, maxWidth: 1100, margin: "2rem auto", fontFamily: "system-ui", padding: "0 1rem" }}>
      <nav style={{ width: 240, flexShrink: 0, position: "sticky", top: 16, alignSelf: "flex-start" }}>
        <Link href="/">← waldocs</Link>
        {d.sections.map((s) => (
          <div key={s.group} style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#888" }}>{s.group}</div>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {s.units.map((u) => <li key={u.title}><a href={`#${encodeURIComponent(u.title)}`}>{u.title}</a></li>)}
            </ul>
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#888" }}>SHOWCASE</div>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {d.showcase.map((a) => <li key={a.slug}><Link href={`/app/${a.slug}`}>{a.descriptiveTitle}</Link></li>)}
          </ul>
        </div>
      </nav>
      <article style={{ flex: 1 }}>
        <h1>{d.name}</h1>
        {d.sections.map((s) => (
          <section key={s.group}>
            <h2 style={{ color: "#888", fontSize: 14 }}>{s.group}</h2>
            {s.units.map((u) => (
              <div key={u.title} id={encodeURIComponent(u.title)}>
                <h3>{u.title}</h3>
                <p style={{ whiteSpace: "pre-wrap" }}>{u.content}</p>
              </div>
            ))}
          </section>
        ))}
        <AskBox entityType="protocol" slug={slug} />
      </article>
    </main>
  );
}
