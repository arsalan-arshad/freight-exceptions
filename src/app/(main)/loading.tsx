export default function Loading() {
  return (
    <div role="status" aria-live="polite">
      <h1 className="visually-hidden">Loading</h1>
      <p className="muted">
        <span className="spinner" aria-hidden="true" />
        Loading
      </p>
    </div>
  );
}
