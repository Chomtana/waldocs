export default function Loading() {
  return (
    <main className="container">
      <div className="hero">
        <h1>waldocs</h1>
        <p className="tagline">Unified developer docs on Walrus Memory — improved by real app usage.</p>
      </div>
      <div className="skeleton skeleton-block" style={{ height: 56 }} />
      <div className="section-label">Protocols</div>
      <ul className="card-list">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <div className="skeleton skeleton-block" style={{ height: 64 }} />
          </li>
        ))}
      </ul>
    </main>
  );
}
