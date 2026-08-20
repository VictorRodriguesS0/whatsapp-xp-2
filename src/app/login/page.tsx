import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/modules/auth/session";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/conversas");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--canvas)] px-5 py-10">
      <section aria-labelledby="login-heading" className="w-full max-w-sm border-t-4 border-[var(--accent)] bg-[var(--panel)] px-7 py-8 shadow-[0_10px_32px_rgba(32,37,34,0.07)] sm:px-9">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">XP Eletrônicos</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--text)]" id="login-heading">Central de atendimento</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Acesse com seu e-mail de funcionário.</p>
        <LoginForm />
      </section>
    </main>
  );
}
