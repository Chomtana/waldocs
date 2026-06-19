export default function Loading() {
  return (
    <div className="docs-layout">
      <aside className="sidebar">
        {[0, 1].map((g) => (
          <div className="group" key={g}>
            <div className="skeleton skeleton-line" style={{ width: "40%" }} />
            <div className="skeleton skeleton-line" style={{ width: "80%" }} />
            <div className="skeleton skeleton-line" style={{ width: "70%" }} />
            <div className="skeleton skeleton-line" style={{ width: "85%" }} />
          </div>
        ))}
      </aside>
      <article className="content">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" style={{ width: "60%" }} />
        <div className="skeleton skeleton-block" />
        <div className="skeleton skeleton-block" />
      </article>
    </div>
  );
}
