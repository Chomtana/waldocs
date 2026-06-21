import Link from "next/link";
import { listProtocols } from "@/lib/queries";
import { ChatBox } from "@/app/_components/ChatBox";

export const dynamic = "force-dynamic";

export default async function Home() {
  const protocols = await listProtocols();
  return (
    <main className="container">
      <div className="hero">
        <h1>waldocs</h1>
        <p className="tagline">Unified developer docs on Walrus Memory — improved by real app usage.</p>
      </div>
      <ChatBox />
      <div className="section-label">Protocols</div>
      <ul className="row-list">
        {protocols.map((p) => (
          <li key={p.slug}>
            <Link href={`/protocol/${p.slug}`} className="row-item">
              <div className="row-body">
                <div className="row-title">{p.name}</div>
                {p.description ? <div className="row-desc">{p.description}</div> : null}
              </div>
              <span className="row-arrow" aria-hidden>→</span>
            </Link>
          </li>
        ))}
        {protocols.length === 0 && (
          <li className="row-empty">No protocols yet — publish an app with the waldocs-publish skill.</li>
        )}
      </ul>
    </main>
  );
}
