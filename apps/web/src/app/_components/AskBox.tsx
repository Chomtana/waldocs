"use client";
import { useState } from "react";

export function AskBox({ entityType, slug }: { entityType: "protocol" | "application"; slug: string }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function ask() {
    setLoading(true);
    setAnswer(null);
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
    <div className="askbox">
      <span className="label">Ask these docs</span>
      <div className="row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && q && !loading && ask()}
          placeholder="Ask a question…"
        />
        <button onClick={ask} disabled={loading || !q}>{loading ? "…" : "Ask"}</button>
      </div>
      {answer && <p className="answer">{answer}</p>}
    </div>
  );
}
