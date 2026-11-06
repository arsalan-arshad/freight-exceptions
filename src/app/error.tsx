'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="notice error" role="alert">
      <h1>Something went wrong</h1>
      <p>The page could not be loaded. Details are in the server log; nothing was sent anywhere.</p>
      <button className="btn" type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
