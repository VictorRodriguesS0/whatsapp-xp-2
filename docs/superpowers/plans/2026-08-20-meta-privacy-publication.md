# Meta Privacy Publication Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar páginas institucionais de privacidade e exclusão de dados no domínio do XP Atendimento para liberar a publicação do aplicativo na Meta.

**Architecture:** Duas páginas estáticas do Next.js App Router reutilizam um componente de documento legal sem estado, sessão, banco ou chamadas externas. A tela de login oferece navegação discreta para os documentos; depois dos gates locais, a mesma imagem é implantada na KVM e as URLs são cadastradas no painel da Meta.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Tailwind CSS 4, Vitest e Testing Library.

## Global Constraints

- Rotas públicas exatas: `/privacidade` e `/exclusao-de-dados`.
- Canal oficial exato: WhatsApp `+55 61 9514-9019`.
- Nenhum formulário, rastreamento, banco de dados, sessão ou API externa nas páginas legais.
- Nenhum segredo, ID interno da Meta ou dado de cliente no HTML.
- Linguagem em português do Brasil, direta e sem promessa de exclusão contrária a obrigação legal.
- Layout cardless, tokens existentes, largura confortável de leitura e alvos de toque de pelo menos 44 px.
- O modo publicado da Meta só pode ser acionado após confirmação explícita do usuário.

---

## File Map

- Create `src/components/legal/legal-document.tsx`: estrutura visual compartilhada, contato oficial e navegação entre documentos.
- Create `src/app/privacidade/page.tsx`: metadados e conteúdo integral da Política de Privacidade.
- Create `src/app/exclusao-de-dados/page.tsx`: metadados e procedimento de solicitação de direitos e exclusão.
- Create `src/app/legal-pages.test.tsx`: contrato público e conteúdo obrigatório das duas páginas.
- Modify `src/app/login/page.tsx`: links públicos discretos abaixo do formulário.
- Create `src/app/login/page.test.tsx`: links legais e preservação do redirecionamento autenticado.
- Modify `docs/superpowers/plans/2026-08-20-meta-privacy-publication.md`: marcar passos executados durante a implementação.

---

### Task 1: Public Legal Documents

**Files:**
- Create: `src/components/legal/legal-document.tsx`
- Create: `src/app/privacidade/page.tsx`
- Create: `src/app/exclusao-de-dados/page.tsx`
- Create: `src/app/legal-pages.test.tsx`

**Interfaces:**
- Consumes: tokens CSS globais `--canvas`, `--panel`, `--text`, `--muted`, `--border` e `--accent`.
- Produces: `LegalDocument({ current, eyebrow, title, description, children })` e as rotas públicas `/privacidade` e `/exclusao-de-dados`.

- [x] **Step 1: Write the failing public-page tests**

Create `src/app/legal-pages.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DataDeletionPage, { metadata as deletionMetadata } from "./exclusao-de-dados/page";
import PrivacyPage, { metadata as privacyMetadata } from "./privacidade/page";

describe("public legal pages", () => {
  it("publishes a complete privacy policy without authentication or forms", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Política de Privacidade" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dados tratados" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Como usamos os dados" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Compartilhamento" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Retenção e segurança" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Seus direitos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+55 61 9514-9019" })).toHaveAttribute(
      "href",
      "https://wa.me/556195149019",
    );
    expect(screen.getByRole("link", { name: "Solicitar exclusão de dados" })).toHaveAttribute(
      "href",
      "/exclusao-de-dados",
    );
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(privacyMetadata.title).toBe("Política de Privacidade | XP Eletrônicos");
  });

  it("gives the privacy WhatsApp link a 44px structural touch target", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("link", { name: "+55 61 9514-9019" })).toHaveClass("inline-flex", "min-h-11");
  });

  it("uses the established high-contrast text token for legal supporting copy", () => {
    render(<PrivacyPage />);

    expect(
      screen.getByText("Como tratamos as informações usadas no atendimento da XP Eletrônicos pelo WhatsApp."),
    ).toHaveClass("text-[var(--text)]");
    expect(screen.getByText("Última atualização: 20 de agosto de 2026")).toHaveClass("text-[var(--text)]");
    expect(screen.getByText("XP Eletrônicos · Atendimento via WhatsApp")).toHaveClass("text-[var(--text)]");
  });

  it("publishes executable data-deletion instructions on the official channel", () => {
    render(<DataDeletionPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Exclusão de dados" })).toBeInTheDocument();
    expect(screen.getByText("Solicitação de exclusão de dados")).toBeInTheDocument();
    expect(screen.getByText(/confirmar sua identidade/i)).toBeInTheDocument();
    expect(screen.getByText(/excluídos ou anonimizados/i)).toBeInTheDocument();
    expect(screen.getByText(/obrigação legal/i)).toBeInTheDocument();
    expect(screen.getByText("Comunicaremos o resultado da solicitação pelo mesmo canal.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enviar solicitação pelo WhatsApp" })).toHaveAttribute(
      "href",
      "https://wa.me/556195149019?text=Solicita%C3%A7%C3%A3o%20de%20exclus%C3%A3o%20de%20dados",
    );
    expect(screen.getByRole("link", { name: "Ler a Política de Privacidade" })).toHaveAttribute(
      "href",
      "/privacidade",
    );
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(deletionMetadata.title).toBe("Exclusão de dados | XP Eletrônicos");
  });
});
```

- [x] **Step 2: Run the tests and verify the expected RED**

Run:

```powershell
npm test -- src/app/legal-pages.test.tsx
```

Expected: FAIL because `./privacidade/page` and `./exclusao-de-dados/page` do not exist.

- [x] **Step 3: Implement the shared legal document shell**

Create `src/components/legal/legal-document.tsx`:

```tsx
import type { ReactNode } from "react";

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
          <a className="inline-flex min-h-11 items-center text-sm font-bold text-[var(--accent)]" href="/login">
            XP Eletrônicos
          </a>
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
```

- [x] **Step 4: Implement the privacy policy page**

Create `src/app/privacidade/page.tsx`:

```tsx
import type { Metadata } from "next";

import { LegalDocument } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Política de Privacidade | XP Eletrônicos",
  description: "Como a XP Eletrônicos trata dados no atendimento pelo WhatsApp.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      current="privacy"
      description="Como tratamos as informações usadas no atendimento da XP Eletrônicos pelo WhatsApp."
      eyebrow="Privacidade"
      title="Política de Privacidade"
    >
      <section>
        <h2>Dados tratados</h2>
        <p>Podemos tratar nome e identificador do WhatsApp, número de telefone, conteúdo das mensagens, anexos enviados, datas, estados de entrega e registros operacionais do atendimento.</p>
      </section>
      <section>
        <h2>Como usamos os dados</h2>
        <p>Usamos essas informações para responder solicitações, organizar o atendimento, atribuir responsáveis, enviar e receber mensagens e manter a segurança e a continuidade do serviço.</p>
      </section>
      <section>
        <h2>Compartilhamento</h2>
        <p>Os dados podem ser compartilhados, na medida necessária, com a Meta e o WhatsApp, com fornecedores de infraestrutura que sustentam o serviço e com autoridades quando houver obrigação legal.</p>
      </section>
      <section>
        <h2>Retenção e segurança</h2>
        <p>Mantemos os dados somente pelo período necessário às finalidades do atendimento e às obrigações legais aplicáveis. Aplicamos controle de acesso, autenticação e medidas técnicas para reduzir acesso, alteração ou divulgação indevida.</p>
      </section>
      <section>
        <h2>Seus direitos</h2>
        <p>Você pode solicitar confirmação do tratamento, acesso, correção ou exclusão de dados elegíveis. Registros cuja conservação seja exigida por lei poderão ser preservados pelo prazo aplicável.</p>
        <p className="mt-3">Envie sua solicitação para <a className="inline-flex min-h-11 items-center font-semibold text-[var(--accent)] underline underline-offset-4" href="https://wa.me/556195149019">+55 61 9514-9019</a>.</p>
      </section>
    </LegalDocument>
  );
}
```

- [x] **Step 5: Implement the data-deletion page**

Create `src/app/exclusao-de-dados/page.tsx`:

```tsx
import type { Metadata } from "next";

import { LegalDocument } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Exclusão de dados | XP Eletrônicos",
  description: "Como solicitar acesso, correção ou exclusão de dados do atendimento da XP Eletrônicos.",
};

export default function DataDeletionPage() {
  return (
    <LegalDocument
      current="deletion"
      description="Use o canal oficial para solicitar acesso, correção ou exclusão de dados vinculados ao seu atendimento."
      eyebrow="Direitos do titular"
      title="Exclusão de dados"
    >
      <section>
        <h2>Como fazer a solicitação</h2>
        <p>Envie a frase <strong>Solicitação de exclusão de dados</strong> pelo WhatsApp oficial da XP Eletrônicos.</p>
        <a className="mt-5 inline-flex min-h-11 items-center rounded-md bg-[var(--accent)] px-5 font-semibold text-white hover:bg-[var(--accent-hover)]" href="https://wa.me/556195149019?text=Solicita%C3%A7%C3%A3o%20de%20exclus%C3%A3o%20de%20dados">Enviar solicitação pelo WhatsApp</a>
      </section>
      <section>
        <h2>Confirmação de identidade</h2>
        <p>Para proteger seus dados, poderemos confirmar sua identidade e pedir informações suficientes para localizar o atendimento relacionado ao pedido.</p>
      </section>
      <section>
        <h2>O que acontece depois</h2>
        <ul>
          <li>Confirmaremos o recebimento pelo mesmo canal.</li>
          <li>Localizaremos e avaliaremos os dados vinculados ao atendimento.</li>
          <li>Os dados elegíveis serão excluídos ou anonimizados.</li>
          <li>Comunicaremos o resultado da solicitação pelo mesmo canal.</li>
        </ul>
      </section>
      <section>
        <h2>Conservação necessária</h2>
        <p>Dados sujeitos a obrigação legal, regulatória ou necessários ao exercício de direitos poderão ser preservados pelo prazo aplicável. Nesses casos, o uso permanecerá limitado à finalidade que justificou a conservação.</p>
      </section>
    </LegalDocument>
  );
}
```

- [x] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- src/app/legal-pages.test.tsx
```

Expected: 4 tests PASS with no warnings.

- [x] **Step 7: Commit Task 1**

```powershell
git add src/components/legal/legal-document.tsx src/app/privacidade/page.tsx src/app/exclusao-de-dados/page.tsx src/app/legal-pages.test.tsx
git commit -m "feat: add public privacy documents"
```

---

### Task 2: Login Navigation and Local Quality Gates

**Files:**
- Modify: `src/app/login/page.tsx`
- Create: `src/app/login/page.test.tsx`

**Interfaces:**
- Consumes: public paths `/privacidade` and `/exclusao-de-dados` from Task 1.
- Produces: discoverable legal navigation on the anonymous login page while preserving authenticated redirect behavior.

- [x] **Step 1: Write failing login-page tests**

Create `src/app/login/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserMock, redirectMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("@/modules/auth/session", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import LoginPage from "./page";

describe("login page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue(null);
  });

  it("links the public privacy and data-deletion documents", async () => {
    render(await LoginPage());

    expect(screen.getByRole("link", { name: "Privacidade" })).toHaveAttribute("href", "/privacidade");
    expect(screen.getByRole("link", { name: "Exclusão de dados" })).toHaveAttribute("href", "/exclusao-de-dados");
  });

  it("keeps authenticated users out of the login page", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1" });

    await expect(LoginPage()).rejects.toThrow("redirect:/conversas");
    expect(redirectMock).toHaveBeenCalledWith("/conversas");
  });
});
```

- [x] **Step 2: Run the login test and verify RED**

Run:

```powershell
npm test -- src/app/login/page.test.tsx
```

Expected: anonymous test FAIL because the two links are absent; redirect test PASS.

- [x] **Step 3: Add legal links below the login form**

In `src/app/login/page.tsx`, add this navigation immediately after `<LoginForm />`:

```tsx
<nav aria-label="Documentos legais" className="mt-6 flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--border)] pt-4 text-sm">
  <a className="inline-flex min-h-11 items-center text-[var(--muted)] underline-offset-4 hover:text-[var(--accent)] hover:underline" href="/privacidade">Privacidade</a>
  <a className="inline-flex min-h-11 items-center text-[var(--muted)] underline-offset-4 hover:text-[var(--accent)] hover:underline" href="/exclusao-de-dados">Exclusão de dados</a>
</nav>
```

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- src/app/legal-pages.test.tsx src/app/login/page.test.tsx
```

Expected: 6 focused tests PASS with no warnings (4 legal-page tests and 2 login-page tests).

- [x] **Step 5: Run complete local gates**

Run each command independently and stop on the first failure:

```powershell
npm test
npm run lint
npm run typecheck
npm run db:validate
npm run build
npm audit --omit=dev
git diff --check
```

Expected: tests have zero failures; lint/typecheck/Prisma/build exit 0; production audit reports zero vulnerabilities; diff check is clean.

- [x] **Step 6: Verify desktop and mobile rendering**

Build and run the production app locally, then verify `/privacidade`, `/exclusao-de-dados` and `/login` at 1440×900 and 390×844. Expected: HTTP 200, no redirect to login for legal routes, no horizontal overflow, one visible H1 per page, links keyboard-focusable and no console errors.

- [x] **Step 7: Commit Task 2**

```powershell
git add src/app/login/page.tsx src/app/login/page.test.tsx
git commit -m "feat: link legal documents from login"
```

---

### Task 3: KVM Deployment and Meta Publication Readiness

**Files:**
- Modify: `docs/superpowers/plans/2026-08-20-meta-privacy-publication.md` only to mark completed checkboxes.

**Interfaces:**
- Consumes: production image built from the two preceding commits and existing isolated Compose/Caddy deployment at `/opt/apps/example-app`.
- Produces: public legal URLs accepted by the Meta application `1960774534600444`.

- [x] **Step 1: Build the exact production image**

Build from the committed worktree using the existing multi-stage Dockerfile and tag it with the new Git commit. Expected: build exit 0 and no secret embedded in build arguments or layers.

- [x] **Step 2: Deploy only the XP Atendimento app**

Transfer the committed release to `/opt/apps/example-app/releases/<git-commit>`, update `/opt/apps/example-app/current`, and run the existing Compose command with `/opt/apps/example-app/.env.production`. Recreate only `app`; leave the PostgreSQL volume and all unrelated KVM systems untouched.

- [x] **Step 3: Verify production URLs**

Run external checks for:

```text
https://whatsapp.xpeletronicos.com/api/health
https://whatsapp.xpeletronicos.com/privacidade
https://whatsapp.xpeletronicos.com/exclusao-de-dados
https://whatsapp.xpeletronicos.com/login
```

Expected: all return HTTP 200; legal pages are available without a session; app container is healthy; webhook GET verification is 200; invalid webhook signature remains 401.

- [x] **Step 4: Run post-deployment browser QA**

Verify the three public pages at desktop and mobile dimensions over HTTPS. Expected: correct XP Eletrônicos copy and phone, no overflow, no console error, legal links work both directions, login continues to work.

- [x] **Step 5: Register the public URLs in Meta**

In Meta app settings for app `1960774534600444`, set:

```text
Privacy Policy URL: https://whatsapp.xpeletronicos.com/privacidade
Data Deletion Instructions URL: https://whatsapp.xpeletronicos.com/exclusao-de-dados
```

Save the settings, return to `/go_live/`, and verify that the publication prerequisite is satisfied. Do not click the final `Publicar` action yet.

- [x] **Step 6: Request the final publication confirmation**

Tell the user that publication will allow real WhatsApp traffic for the subscribed WABA and number. Ask for an explicit confirmation immediately before clicking `Publicar`.

- [x] **Step 7: Publish and test a real inbound message**

After confirmation, publish the Meta app. Ask the user to send a message from another phone to `+55 61 9514-9019`. Verify the signed webhook is processed, the conversation appears once in the inbox, and no token, phone payload or customer message body is emitted in application error logs.

- [x] **Step 8: Record evidence and final status**

Mark this plan's checkboxes, record the Git commit, image identifier, production HTTP results, Meta publication status and the real-message result. Commit those evidence records explicitly, then run `git status --short` and require a clean worktree before reporting completion.

### Production evidence — 20 August 2026

- final application release: `7019c2b9f8475b76506de51914e7a8539d925b22`;
- production image: `xp-whatsapp:7019c2b`, image ID beginning `sha256:f2712725`;
- deployment: application service only, through the canonical KVM Compose, with the database, Caddy, volumes and unrelated containers preserved;
- Compose configuration hash: expected and actual `eec91ce4...`;
- public health, privacy, data-deletion and login routes: HTTP 200 after deployment and after Meta publication;
- Meta application `1960774534600444`: privacy and data-deletion URLs saved; publication confirmed by Meta and final status `Publicado`;
- live WhatsApp number: `+55 61 9514-9019`;
- real inbound acceptance: one new text message persisted once as `INBOUND/TEXT/RECEIVED`, with one distinct provider message ID and one matching `message/PROCESSED` webhook event;
- post-message health: application `running/healthy`, no media persistence failure, invalid signature or duplicate inbound message;
- logging boundary: no customer message body, phone payload, token, app secret or webhook signature was printed during verification.

---

## Self-Review Result

- Spec coverage: public access, required policy content, deletion flow, official contact, login links, responsive verification, KVM deployment and Meta confirmation boundary are each assigned to a task.
- Placeholder scan: no marcador pendente, implementação adiada ou interface indefinida permanece.
- Type consistency: `LegalDocument` props and the two public paths are identical in producing and consuming tasks.
