import Link from "next/link";
import { listProtocols } from "@/lib/queries";
import { ChatBox } from "@/app/_components/ChatBox";

export const dynamic = "force-dynamic";

export default async function Home() {
  const protocols = await listProtocols();
  return (
    <main style={{ maxWidth: 820, margin: "2rem auto", fontFamily: "system-ui", padding: "0 1rem" }}>
      <h1>waldocs</h1>
      <ChatBox />
      <h2>Protocols</h2>
      <ul>
        {protocols.map((p) => (
          <li key={p.slug} style={{ marginBottom: 8 }}>
            <Link href={`/protocol/${p.slug}`}><strong>{p.name}</strong></Link>
            {p.description ? <div style={{ color: "#555" }}>{p.description}</div> : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
