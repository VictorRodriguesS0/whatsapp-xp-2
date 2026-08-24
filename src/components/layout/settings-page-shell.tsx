import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { AppBrand } from "@/components/brand/app-brand";
import { ThemeMenu } from "@/components/theme/theme-menu";

type SettingsPageShellProps = {
  actions?: ReactNode;
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
};

export function SettingsPageShell({ actions, children, description, eyebrow, title }: SettingsPageShellProps) {
  return (
    <main aria-labelledby="settings-page-heading" className="min-h-dvh bg-[var(--canvas)] px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="border-b border-[var(--border)] pb-5">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <AppBrand href="/conversas" />
            <ThemeMenu />
          </div>
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <a className="inline-flex min-h-11 items-center gap-2 rounded-xl text-sm font-semibold text-[var(--muted)] outline-none hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]" href="/conversas">
                <ArrowLeft aria-hidden="true" className="size-4" /> Conversas
              </a>
              <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-[var(--accent)]">{eyebrow}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight" id="settings-page-heading">{title}</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
            </div>
            {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
          </div>
        </header>
        <div className="py-6">{children}</div>
      </div>
    </main>
  );
}
