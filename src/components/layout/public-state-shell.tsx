import type { ReactNode } from "react";

import { AppBrand } from "@/components/brand/app-brand";
import { ThemeMenu } from "@/components/theme/theme-menu";

export function PublicStateShell({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--canvas)] px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full max-w-xl">
        <header className="mb-4 flex min-h-11 items-center justify-between gap-3">
          <AppBrand href="/login" />
          <ThemeMenu />
        </header>
        <section aria-labelledby="public-state-heading" className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-6 py-8 shadow-[0_16px_44px_rgba(17,24,39,0.1)] sm:px-9">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--accent)]">{eyebrow}</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--text)]" id="public-state-heading">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p>
          <div className="mt-6 flex flex-col gap-2 min-[390px]:flex-row min-[390px]:flex-wrap">{actions}</div>
        </section>
      </div>
    </main>
  );
}
