"use client";

import "./globals.css";

export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-sand-50 p-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">DriveEasy is temporarily unavailable</h1>
          <p className="mt-2 text-sm text-ink-600">Please try again in a moment.</p>
          <button
            type="button"
            onClick={() => retry()}
            className="mt-6 rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
