export default function Loading() {
  return (
    <main className="container">
      <div className="hero">
        <h1>waldocs</h1>
        <p className="tagline">Unified developer docs on Walrus Memory — improved by real app usage.</p>
      </div>
      <div className="skeleton skeleton-block" style={{ height: 56 }} />
      <div className="section-label">Protocols</div>
      <ul className="row-list">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <div style={{ padding: "16px 8px" }}>
              <div className="skeleton skeleton-line" style={{ width: "30%", height: 16, margin: 0 }} />
              <div className="skeleton skeleton-line" style={{ width: "60%", marginTop: 8, marginBottom: 0 }} />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
