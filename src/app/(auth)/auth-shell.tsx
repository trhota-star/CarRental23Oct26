import type { ReactNode } from "react";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 items-start justify-center bg-gradient-to-b from-ink-50 to-sand-50 px-4 py-12 sm:py-20">
      <div className="w-full max-w-md rounded-card border border-ink-100 bg-white p-6 shadow-card sm:p-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
        <p className="mt-1 mb-6 text-sm text-ink-600">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
