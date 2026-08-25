import type { ReactNode } from "react";

import { AppBrand } from "@/components/brand/app-brand";
import { ThemeMenu } from "@/components/theme/theme-menu";

type LegalDocumentProps = {
  children: ReactNode;
  current: "privacy" | "deletion";
  description: string;
  eyebrow: string;
  title: string;
};

export function LegalDocument({ children, current, description, eyebrow, title }: LegalDocumentProps) {
  return (
    <main className="min-h-dvh bg-[var(--canvas)] px-5 py-10 sm:px-8 sm:py-14">
      <article className="mx-auto max-w-3xl">
        <header className="border-b border-[var(--border)] pb-8">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <AppBrand href="/login" />
            <ThemeMenu />
          </div>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--text)] sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--text)]">{description}</p>
          <p className="mt-4 text-sm text-[var(--text)]">Última atualização: 20 de agosto de 2026</p>
        </header>

        <div className="space-y-9 py-9 text-[15px] leading-7 text-[var(--text)] [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-2">
          {children}
        </div>

        <footer className="flex flex-col gap-2 border-t border-[var(--border)] pt-6 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[var(--text)]">XP Eletrônicos · Atendimento via WhatsApp</span>
          {current === "privacy" ? (
            <a className="inline-flex min-h-11 items-center font-semibold text-[var(--accent)]" href="/exclusao-de-dados">
              Solicitar exclusão de dados
            </a>
          ) : (
            <a className="inline-flex min-h-11 items-center font-semibold text-[var(--accent)]" href="/privacidade">
              Ler a Política de Privacidade
            </a>
          )}
        </footer>
      </article>
    </main>
  );
}
