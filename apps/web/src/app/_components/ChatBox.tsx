"use client";
import { useState } from "react";

export function ChatBox() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function ask() {
    setLoading(true); setAnswer(null);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
      const json = await res.json();
      setAnswer(res.ok ? json.answer : `Error: ${json.error ?? "failed"}`);
    } catch {
      setAnswer("Error: request failed. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div style={{ padding: 16, border: "2px solid #333", borderRadius: 8, marginBottom: 24 }}>
      <strong>Ask waldocs anything</strong>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="How do I store a blob on Walrus?" style={{ flex: 1, padding: 8 }} />
        <button onClick={ask} disabled={loading || !q}>{loading ? "…" : "Ask"}</button>
      </div>
      {answer && <p style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{answer}</p>}
    </div>
  );
}
