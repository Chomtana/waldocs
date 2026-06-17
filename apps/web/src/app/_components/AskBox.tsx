"use client";
import { useState } from "react";

export function AskBox({ entityType, slug }: { entityType: "protocol" | "application"; slug: string }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function ask() {
    setLoading(true); setAnswer(null);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entityType, slug, question: q }) });
      const json = await res.json();
      setAnswer(res.ok ? json.answer : `Error: ${json.error ?? "failed"}`);
    } catch {
      setAnswer("Error: request failed. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div style={{ marginTop: 24, padding: 12, border: "1px solid #ddd" }}>
      <strong>Ask these docs</strong>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question…" style={{ flex: 1, padding: 6 }} />
        <button onClick={ask} disabled={loading || !q}>{loading ? "…" : "Ask"}</button>
      </div>
      {answer && <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{answer}</p>}
    </div>
  );
}
