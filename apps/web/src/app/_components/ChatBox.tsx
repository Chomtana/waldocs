"use client";
import { useState } from "react";

export function ChatBox() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function ask() {
    setLoading(true);
    setAnswer(null);
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
    <div className="askbox hero-chat">
      <span className="label">Ask waldocs anything</span>
      <div className="row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && q && !loading && ask()}
          placeholder="How do I store a blob on Walrus?"
        />
        <button onClick={ask} disabled={loading || !q}>{loading ? "…" : "Ask"}</button>
      </div>
      {answer && <p className="answer">{answer}</p>}
    </div>
  );
}
