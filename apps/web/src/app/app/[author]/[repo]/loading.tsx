export default function Loading() {
  return (
    <main className="container">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" style={{ width: "50%" }} />
      <div className="skeleton skeleton-block" />
      <div className="skeleton skeleton-block" />
      <div className="skeleton skeleton-block" />
    </main>
  );
}
