import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { AppBrand } from "@/components/brand/app-brand";
import { ThemeMenu } from "@/components/theme/theme-menu";
import { getCurrentUser } from "@/modules/auth/session";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/conversas");

  return (
    <main className="login-page flex min-h-dvh items-center justify-center bg-[var(--canvas)] px-4 py-5 sm:px-6 sm:py-8">
      <div className="relative w-full max-w-5xl pt-14">
        <div className="absolute right-0 top-0"><ThemeMenu /></div>
        <div className="login-layout relative mx-auto overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[0_18px_55px_rgba(17,24,39,0.12)]">
          <div aria-hidden="true" className="login-signature absolute inset-x-0 top-0 h-1" />
          <section aria-label="XP Atendimento" className="login-brand-panel bg-[var(--surface)] p-10">
            <AppBrand />
            <div className="mt-auto max-w-md pt-20">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">XP Atendimento</p>
              <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-[var(--text)]">Atendimento organizado, contexto preservado.</h2>
              <p className="mt-4 max-w-sm text-sm leading-6 text-[var(--muted)]">Uma central operacional para a equipe acompanhar cada conversa com clareza.</p>
            </div>
          </section>

          <section aria-labelledby="login-heading" className="login-card bg-[var(--panel)] px-6 py-8 sm:px-9 sm:py-10">
            <div className="login-card-brand mb-8"><AppBrand /></div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Acesso da equipe</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--text)]" id="login-heading">Central de atendimento</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Acesse com seu e-mail de funcionário.</p>
            <p className="login-card-value mt-5 text-sm font-semibold leading-6 text-[var(--text)]">Atendimento organizado, contexto preservado.</p>
            <LoginForm />
            <nav aria-label="Documentos legais" className="mt-6 flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--border)] pt-4 text-sm">
              <a className="inline-flex min-h-11 items-center text-[var(--muted)] underline-offset-4 hover:text-[var(--accent)] hover:underline" href="/privacidade">Privacidade</a>
              <a className="inline-flex min-h-11 items-center text-[var(--muted)] underline-offset-4 hover:text-[var(--accent)] hover:underline" href="/exclusao-de-dados">Exclusão de dados</a>
            </nav>
          </section>
        </div>
      </div>
    </main>
  );
}
