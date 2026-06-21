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
      <span className="label">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        </svg>
        Ask these docs
      </span>
      <div className="row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && q && !loading && ask()}
          placeholder="Ask a question about this page…"
        />
        <button onClick={ask} disabled={loading || !q}>{loading ? "…" : "Ask"}</button>
      </div>
      {answer && <p className="answer">{answer}</p>}
    </div>
  );
}
