# XP Atendimento Responsive PWA Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reformular todo o frontend do XP Atendimento com identidade XP, composição responsiva entre 320 e 1440 px, temas claro/escuro/sistema acessíveis e instalação PWA `standalone`, preservando todas as funções e os dados online existentes.

**Architecture:** A aplicação continuará sendo um único Next.js App Router autenticado e online. Um tema semântico aplicado antes da primeira pintura alimentará componentes compartilhados de marca e layout; a inbox será separada em sidebar, thread, ações e inspetor responsivos; estados SSE manterão dados anteriores; configurações alternarão entre tabela e cartões por CSS; o PWA usará manifesto e ícones locais sem service worker ou cache offline.

**Tech Stack:** Next.js 16.3.1 App Router, React 19.2.8, TypeScript 7, Tailwind CSS 4.3.3, Radix UI, Lucide, Geist, Vitest 4.1.11, Testing Library, Sharp 0.35.3, Docker Compose, PostgreSQL 18.

## Global Constraints

- A especificação aprovada em `docs/superpowers/specs/2026-08-24-responsive-pwa-redesign.md` é a fonte de verdade.
- Não alterar REST, autenticação, Prisma, webhook, regras da Meta, SSE ou armazenamento de mídia, salvo correção estritamente necessária para preservar a apresentação.
- Não copiar pixels nem assets do WhatsApp; manter somente o modelo mental lista/conversa/detalhes.
- Incorporar a marca XP localmente. A aplicação em execução não pode buscar logo, fonte ou ícone do site da loja.
- Verde é exclusivo do canal WhatsApp e de sucesso; seleção, foco, ações e contadores usam azul/ciano XP.
- O tema oferece `light`, `dark` e `system`, persiste somente a preferência visual e deve ser aplicado antes da primeira pintura.
- Alvos interativos têm pelo menos 44 × 44 px, foco visível e nome acessível.
- Larguras obrigatórias: 320, 390, 768, 900, 1024, 1280 e 1440 px, sem rolagem horizontal da página.
- Atualizações de realtime não podem esvaziar lista ou histórico já visível.
- O PWA é sempre online. Não criar `sw.js`, Workbox, cache de API, cache de mídia, push ou background sync.
- Evidência visual local deve usar dados sintéticos; não versionar capturas com conversas ou contatos reais de produção.
- Antes do deploy, auditar novamente todas as worktrees/branches e integrar somente trabalho concluído e testado.
- O deploy recria somente `xp-whatsapp-app`; não reiniciar banco, site principal, proxy, volumes, redes ou outros containers.

## File Map

- `src/lib/theme.ts`: contrato puro da preferência e resolução do tema.
- `src/components/theme/theme-provider.tsx`: bootstrap, persistência e sincronização do tema.
- `src/components/theme/theme-menu.tsx`: seletor acessível claro/escuro/sistema.
- `src/components/brand/app-brand.tsx`: símbolo e wordmark XP reutilizáveis.
- `src/components/layout/settings-page-shell.tsx`: cabeçalho e canvas comuns às configurações.
- `src/components/ui/dropdown-menu.tsx`: menu Radix compartilhado.
- `src/components/ui/tooltip.tsx`: tooltip para controles apenas com ícone.
- `src/app/globals.css`: tokens, temas, breakpoints, safe areas, foco e movimento.
- `src/app/layout.tsx`: Geist, tema inicial, metadados e ícones.
- `src/app/manifest.ts`: manifesto PWA online.
- `scripts/generate-pwa-icons.mjs`: geração determinística dos ícones locais.
- `public/brand/xp-symbol.png`: símbolo oficial aprovado como fonte local.
- `public/icons/*`: favicon, Apple Touch Icon e ícones PWA.
- `src/hooks/use-inbox.ts`: atualização preservando conteúdo já carregado.
- `src/components/inbox/conversation-sidebar.tsx`: marca, navegação, busca e lista.
- `src/components/inbox/inbox-shell.tsx`: orquestração responsiva e histórico do navegador.
- `src/components/inbox/conversation-list-skeleton.tsx`: skeleton somente da carga inicial.
- `src/components/inbox/thread-header.tsx`: cabeçalho adaptativo da conversa.
- `src/components/inbox/message-timeline.tsx`: viewport e agrupamento do histórico.
- `src/components/inbox/message-actions.tsx`: hover/foco no desktop e menu explícito no celular.
- `src/components/inbox/message-composer.tsx`: compositor responsivo e safe area.
- `src/components/inbox/customer-panel.tsx`: inspetor responsivo do contato.
- `src/components/users/responsive-settings-list.tsx`: tabela desktop e cartões mobile.
- `src/components/users/users-screen.tsx`: diretório de usuários sem overflow.
- `src/components/settings/*-screen.tsx`: telas administrativas com shell comum.
- `src/components/meta-health/meta-health-screen.tsx`: tela Meta com shell comum.
- `src/app/login/page.tsx`: login responsivo e XP-branded.
- `src/components/legal/legal-document.tsx`: páginas públicas tematizadas.
- `src/app/error.tsx`, `src/app/not-found.tsx` and each settings route's `loading.tsx`/`error.tsx`: coherent failure and loading states.

---

### Task 1: Theme contract, first-paint bootstrap, and semantic tokens

**Files:**
- Create: `src/lib/theme.ts`
- Create: `src/lib/theme.test.ts`
- Create: `src/components/theme/theme-provider.tsx`
- Create: `src/components/theme/theme-provider.test.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `ThemePreference = "light" | "dark" | "system"`.
- Produces: `resolveTheme(preference, systemDark): "light" | "dark"`.
- Produces: `ThemeProvider`, `useTheme()` and `themeBootstrapScript`.
- Consumes: `localStorage["xp-atendimento-theme"]` and `matchMedia("(prefers-color-scheme: dark)")`.

- [ ] **Step 1: Write failing pure theme tests**

Cover valid/invalid persisted values, all three preferences, system light/dark resolution and the fixed storage key.

```ts
expect(resolveTheme("light", true)).toBe("light");
expect(resolveTheme("dark", false)).toBe("dark");
expect(resolveTheme("system", true)).toBe("dark");
expect(isThemePreference("sepia")).toBe(false);
```

- [ ] **Step 2: Run the pure test and verify RED**

Run: `npm test -- src/lib/theme.test.ts`

Expected: FAIL because `src/lib/theme.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure contract**

```ts
export const THEME_STORAGE_KEY = "xp-atendimento-theme";
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean,
): ResolvedTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}
```

- [ ] **Step 4: Write failing provider tests**

Render a probe under `ThemeProvider`. Assert that an invalid stored value falls back to `system`; `setPreference("dark")` persists it; `document.documentElement.dataset.theme` and `colorScheme` change; a system media-query event changes the resolved theme only under `system`; and the generated bootstrap contains no user data or remote URL.

- [ ] **Step 5: Run the provider test and verify RED**

Run: `npm test -- src/components/theme/theme-provider.test.tsx`

Expected: FAIL because the provider is absent.

- [ ] **Step 6: Implement bootstrap and provider**

The context contract must stay small:

```ts
type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference(preference: ThemePreference): void;
};
```

`themeBootstrapScript` must synchronously read the stored preference, resolve the media query, set `data-theme`, set `style.colorScheme`, and fall back to `system` inside `try/catch`. The provider must repeat the same operation after hydration and subscribe/unsubscribe to media-query changes.

- [ ] **Step 7: Define independent light and dark tokens**

Replace the current palette with semantic tokens. Keep the approved brand constants and give dark surfaces their own values:

```css
:root,
:root[data-theme="light"] {
  --xp-black: #050505;
  --xp-cyan: #00d7e8;
  --xp-orange: #ffad00;
  --xp-violet: #7238ff;
  --xp-magenta: #ff009f;
  --xp-blue: #087dff;
  --xp-gradient: linear-gradient(110deg, #ffad00 0%, #ff009f 30%, #7238ff 55%, #087dff 76%, #00d7e8 100%);
  --canvas: #eef2f6;
  --panel: #ffffff;
  --surface: #f7f9fb;
  --surface-elevated: #ffffff;
  --text: #101114;
  --muted: #5d6673;
  --border: #dce2e9;
  --accent: #087dff;
  --accent-hover: #066bdc;
  --focus: #087dff;
  --selected: #e8f2ff;
  --inbound: #ffffff;
  --outbound: #e7f5ef;
  --channel: #168b61;
  --danger: #c23b3b;
  --warning: #fff3cf;
  --success: #e4f5ec;
  --search-mark: #ffe38a;
  color-scheme: light;
}

:root[data-theme="dark"] {
  --canvas: #0b0d10;
  --panel: #111419;
  --surface: #181c22;
  --surface-elevated: #1e232b;
  --text: #f5f7fa;
  --muted: #a9b2bf;
  --border: #2a3039;
  --accent: #5aa7ff;
  --accent-hover: #80bbff;
  --focus: #75c8ff;
  --selected: #162b46;
  --inbound: #1b2027;
  --outbound: #15342d;
  --channel: #5dd3a5;
  --danger: #ff7b7b;
  --warning: #3a3018;
  --success: #163729;
  --search-mark: #6b581d;
  color-scheme: dark;
}
```

Also set `overflow-wrap: anywhere`, media-safe max widths, `:focus-visible`, selection colors, `scrollbar-gutter`, 200% zoom-safe sizing and the existing reduced-motion override.

- [ ] **Step 8: Wire Geist and pre-paint theme into the root layout**

Use `Geist` from `next/font/google`, `suppressHydrationWarning` on `<html>`, the bootstrap `<script>` before children and `ThemeProvider` around the app. Do not load a runtime font URL.

- [ ] **Step 9: Run focused checks and commit**

Run: `npm test -- src/lib/theme.test.ts src/components/theme/theme-provider.test.tsx src/app/login/page.test.tsx`

Expected: PASS with no hydration warning emitted by the tests.

```powershell
git add src/lib/theme.ts src/lib/theme.test.ts src/components/theme/theme-provider.tsx src/components/theme/theme-provider.test.tsx src/app/layout.tsx src/app/globals.css
git commit -m "feat: add accessible XP color themes"
```

### Task 2: Local XP brand assets and online-only PWA metadata

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/generate-pwa-icons.mjs`
- Create: `public/brand/xp-symbol.png`
- Create: `public/icons/xp-16.png`
- Create: `public/icons/xp-32.png`
- Create: `public/icons/xp-180.png`
- Create: `public/icons/xp-192.png`
- Create: `public/icons/xp-512.png`
- Create: `public/icons/xp-maskable-512.png`
- Create: `src/app/manifest.ts`
- Create: `src/app/manifest.test.ts`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `/manifest.webmanifest` with `start_url: "/conversas"`, `scope: "/"`, `display: "standalone"`.
- Produces: local raster icons with `any` and `maskable` purposes.
- Produces no service worker and no offline cache.

- [ ] **Step 1: Write the failing manifest contract**

```ts
import manifest from "./manifest";

expect(manifest()).toMatchObject({
  name: "XP Atendimento",
  short_name: "XP Atendimento",
  start_url: "/conversas",
  scope: "/",
  display: "standalone",
  background_color: "#050505",
  theme_color: "#050505",
});
expect(manifest().icons).toEqual(expect.arrayContaining([
  expect.objectContaining({ src: "/icons/xp-192.png", sizes: "192x192" }),
  expect.objectContaining({ src: "/icons/xp-512.png", sizes: "512x512", purpose: "any" }),
  expect.objectContaining({ src: "/icons/xp-maskable-512.png", purpose: "maskable" }),
]));
```

The test must also assert every declared local file exists and is non-empty, and assert `public/sw.js` does not exist.

- [ ] **Step 2: Run the contract and verify RED**

Run: `npm test -- src/app/manifest.test.ts`

Expected: FAIL because the manifest and icon files do not exist.

- [ ] **Step 3: Import and inspect the approved official symbol**

Create the directories, download only the already-approved public brand asset, inspect it visually, and keep it local:

```powershell
New-Item -ItemType Directory -Force public/brand, public/icons
Invoke-WebRequest -Uri "https://www.xpeletronicos.com/xp-symbol.png" -OutFile "public/brand/xp-symbol.png"
```

Expected: a non-empty XP controller symbol matching the audited store identity. If the response is HTML, a different logo, or transparent/illegible, stop this task and compare it with the approved reference before generating derivatives.

- [ ] **Step 4: Add deterministic icon tooling**

Run: `npm install --save-dev sharp@0.35.3`

Create `scripts/generate-pwa-icons.mjs` using the locally committed source. Standard icons use a black square and `contain`; the maskable icon keeps the logo inside the central 66% safe zone:

```js
import sharp from "sharp";

const source = "public/brand/xp-symbol.png";
const background = { r: 5, g: 5, b: 5, alpha: 1 };

for (const size of [16, 32, 180, 192, 512]) {
  await sharp(source)
    .resize(size, size, { fit: "contain", background })
    .png({ compressionLevel: 9 })
    .toFile(`public/icons/xp-${size}.png`);
}

const safeSize = Math.round(512 * 0.66);
const safeLogo = await sharp(source)
  .resize(safeSize, safeSize, { fit: "contain", background })
  .png()
  .toBuffer();

await sharp({ create: { width: 512, height: 512, channels: 4, background } })
  .composite([{ input: safeLogo, gravity: "center" }])
  .png({ compressionLevel: 9 })
  .toFile("public/icons/xp-maskable-512.png");
```

Add script: `"icons:generate": "node scripts/generate-pwa-icons.mjs"`, run `npm run icons:generate`, inspect 32, 180, 192, 512 and circular-cropped maskable previews on light/dark backgrounds.

- [ ] **Step 5: Implement the Next manifest**

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "XP Atendimento",
    short_name: "XP Atendimento",
    description: "Central interna de atendimento da XP Eletrônicos.",
    start_url: "/conversas",
    scope: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#050505",
    icons: [
      { src: "/icons/xp-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/xp-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/xp-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

- [ ] **Step 6: Complete layout metadata**

Add `icons`, `manifest`, `appleWebApp` and `applicationName` to `metadata`; export `Viewport` with `viewportFit: "cover"` and light/dark media-aware theme colors. The theme provider must update the active `meta[name="theme-color"]` after a manual preference change.

- [ ] **Step 7: Verify metadata and commit**

Run:

```powershell
npm test -- src/app/manifest.test.ts src/components/theme/theme-provider.test.tsx
npm run typecheck
```

Expected: PASS; all icon files are non-empty; no service worker exists.

```powershell
git add package.json package-lock.json scripts/generate-pwa-icons.mjs public/brand public/icons src/app/manifest.ts src/app/manifest.test.ts src/app/layout.tsx src/components/theme/theme-provider.tsx src/components/theme/theme-provider.test.tsx
git commit -m "feat: make XP Atendimento installable"
```

### Task 3: Shared brand, theme, menu, tooltip, and page-shell primitives

**Files:**
- Create: `src/components/brand/app-brand.tsx`
- Create: `src/components/brand/app-brand.test.tsx`
- Create: `src/components/theme/theme-menu.tsx`
- Create: `src/components/theme/theme-menu.test.tsx`
- Create: `src/components/ui/dropdown-menu.tsx`
- Create: `src/components/ui/tooltip.tsx`
- Create: `src/components/layout/settings-page-shell.tsx`
- Create: `src/components/layout/settings-page-shell.test.tsx`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/input.tsx`
- Modify: `src/components/ui/dialog.tsx`
- Modify: `src/components/ui/avatar.tsx`
- Modify: `src/components/ui/badge.tsx`

**Interfaces:**
- Produces: `AppBrand({ compact?, href?, label? })` with a local logo and readable wordmark.
- Produces: `ThemeMenu` as an accessible radio menu for all three preferences.
- Produces: `SettingsPageShell({ eyebrow, title, description, actions, children })`.
- Keeps: 44 px controls and existing `Button` API.

- [ ] **Step 1: Write failing component contracts**

Assert that `AppBrand` references `/brand/xp-symbol.png`; compact and full variants keep an accessible `XP Eletrônicos` name; `ThemeMenu` exposes the current preference as checked and changes it; `SettingsPageShell` renders a back link, brand, theme control, heading and action slot.

- [ ] **Step 2: Run the contracts and verify RED**

Run:

```powershell
npm test -- src/components/brand/app-brand.test.tsx src/components/theme/theme-menu.test.tsx src/components/layout/settings-page-shell.test.tsx
```

Expected: module import failures.

- [ ] **Step 3: Implement the primitives**

Use Radix dropdown radio items and tooltip primitives. Keep the theme labels exactly `Claro`, `Escuro`, `Seguir o sistema`. `AppBrand` must use a plain local `<img>` with explicit dimensions to avoid layout shift and no remote image configuration.

```tsx
<DropdownMenuRadioGroup value={preference} onValueChange={setPreference}>
  <DropdownMenuRadioItem value="light">Claro</DropdownMenuRadioItem>
  <DropdownMenuRadioItem value="dark">Escuro</DropdownMenuRadioItem>
  <DropdownMenuRadioItem value="system">Seguir o sistema</DropdownMenuRadioItem>
</DropdownMenuRadioGroup>
```

- [ ] **Step 4: Refine base controls without changing behavior**

Use `--focus`, `--surface`, `--surface-elevated`, 10–12 px corner radii and dark-safe backgrounds. `DialogContent` becomes a right drawer by default, but a `.modal-dialog` override centers it; under 768 px, modal dialogs use `inset: max(0.5rem, env(safe-area-inset-*)))`, near-full width/height, internal scrolling and a 44 px close button.

- [ ] **Step 5: Run component regressions and commit**

Run:

```powershell
npm test -- src/components/brand/app-brand.test.tsx src/components/theme/theme-menu.test.tsx src/components/layout/settings-page-shell.test.tsx src/components/auth/login-form.test.tsx src/components/users/user-form.test.tsx src/components/inbox/contact-type-selector.test.tsx
```

Expected: PASS; existing forms still expose the same roles and labels.

```powershell
git add src/components/brand src/components/theme/theme-menu.tsx src/components/theme/theme-menu.test.tsx src/components/layout src/components/ui src/app/globals.css
git commit -m "feat: add shared XP interface primitives"
```

### Task 4: Preserve inbox data during realtime refresh and add initial skeletons

**Files:**
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`
- Create: `src/components/inbox/conversation-list-skeleton.tsx`
- Create: `src/components/inbox/conversation-list-skeleton.test.tsx`
- Modify: `src/components/inbox/conversation-list.tsx`
- Modify: `src/components/inbox/conversation-list.test.tsx`
- Modify: `src/components/inbox/connection-banner.tsx`

**Interfaces:**
- `refreshList({ reset: true })` resets pagination but keeps current rows until the authoritative response resolves.
- Search changes may still clear results because the user changed the query context.
- Skeleton renders only when `loading && items.length === 0`.
- Connected content remains interactive while the reconnection status is announced.

- [ ] **Step 1: Write the deferred realtime regression test**

Start with a loaded first page, defer the second `/api/conversations` response, trigger `FakeEventSource.instances[0].onopen`, and assert the old item remains throughout `loadingList === true`. Resolve the response and assert the authoritative page replaces it. Reject a refresh and assert old items remain with a public retry error.

- [ ] **Step 2: Run the hook test and verify RED**

Run: `npm test -- src/hooks/use-inbox.test.tsx`

Expected: FAIL because `refreshList({ reset: true })` currently executes `setConversations([])`.

- [ ] **Step 3: Preserve visible data while resetting pagination**

Remove only the destructive clear from the `reset` branch:

```ts
if (reset) {
  pageRequest.current = null;
  hasLoadedAdditionalPages.current = false;
  nextCursorRef.current = null;
  setNextCursor(null);
  setLoadingMore(false);
  setLoadMoreError(null);
}
```

Keep `changeSearch()` clearing stale results from a different query. On success, `hasLoadedAdditionalPages.current === false` replaces rows atomically. On failure, list error is shown above preserved rows.

- [ ] **Step 4: Write and implement skeleton tests**

Require six inert geometry rows, a single polite status `Carregando conversas`, and no conversation buttons. Replace the initial centered spinner with the skeleton; never render it over existing items.

- [ ] **Step 5: Refine connection status**

Keep `role="status"`, add `aria-live="polite"`, keep it non-modal and reserve only its own compact height. Name the export `ConnectionStatus` and retain a compatibility alias if tests or imports need an incremental migration.

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
npm test -- src/hooks/use-inbox.test.tsx src/components/inbox/conversation-list-skeleton.test.tsx src/components/inbox/conversation-list.test.tsx
```

Expected: PASS, including the existing pagination and search-reset cases.

```powershell
git add src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx src/components/inbox/conversation-list-skeleton.tsx src/components/inbox/conversation-list-skeleton.test.tsx src/components/inbox/conversation-list.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/connection-banner.tsx
git commit -m "fix: preserve inbox content during refresh"
```

### Task 5: Responsive app shell and dense conversation sidebar

**Files:**
- Create: `src/components/inbox/conversation-sidebar.tsx`
- Create: `src/components/inbox/conversation-sidebar.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`
- Modify: `src/components/inbox/conversation-list.tsx`
- Modify: `src/components/inbox/conversation-list.test.tsx`
- Modify: `src/hooks/use-mobile-inbox-history.ts`
- Modify: `src/hooks/use-mobile-inbox-history.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Desktop: `clamp(320px, 23vw, 370px) minmax(0, 1fr) clamp(280px, 20vw, 330px)`.
- Tablet 768–1199: sidebar + thread; inspector drawer.
- Mobile 320–767: exactly one visible layer, with history/back integration.
- `ConversationSidebar` owns brand/header, settings menu, search mode, search field and result list, but receives existing callbacks/state.

- [ ] **Step 1: Write failing sidebar and shell contracts**

Assert the sidebar renders `AppBrand`, `ThemeMenu`, accessible `Conversas/Mensagens` controls with `min-h-11`, one settings menu rather than four cramped icons, and current list/search behavior. Update mobile tests to use `(max-width: 767px)` and add boundary cases for 767 mobile and 768 tablet.

- [ ] **Step 2: Run the focused suite and verify RED**

Run:

```powershell
npm test -- src/components/inbox/conversation-sidebar.test.tsx src/components/inbox/inbox-shell.test.tsx src/hooks/use-mobile-inbox-history.test.tsx
```

Expected: missing component and old 719 px boundary failures.

- [ ] **Step 3: Extract `ConversationSidebar` without moving state ownership**

`InboxShell` continues to own `useInbox`, selected conversation, history and reply/search targets. The new component receives state/callback props; it must not fetch data or create a second hook instance.

```ts
type ConversationSidebarProps = {
  user: SessionUser;
  metaHealthSummary?: MetaHealthSummaryDto | null;
  searchMode: "conversations" | "messages";
  onSearchModeChange(value: "conversations" | "messages"): void;
  conversationList: ReactNode;
  messageSearchResults: ReactNode;
  conversationQuery: string;
  messageQuery: string;
  onConversationQueryChange(value: string): void;
  onMessageQueryChange(value: string): void;
  onLogout(): void;
};
```

- [ ] **Step 4: Implement the approved responsive grid**

```css
.inbox-grid {
  display: grid;
  grid-template-columns: clamp(320px, 23vw, 370px) minmax(0, 1fr) clamp(280px, 20vw, 330px);
}

@media (min-width: 768px) and (max-width: 1199px) {
  .inbox-grid { grid-template-columns: minmax(300px, 36vw) minmax(0, 1fr); }
  .customer-pane { display: none; }
  .details-trigger { display: inline-flex; }
}

@media (max-width: 767px) {
  .inbox-frame { border: 0; border-radius: 0; }
  .inbox-grid { display: grid; grid-template-columns: 1fr; overflow: hidden; }
  .conversation-pane,
  .thread-pane { grid-area: 1 / 1; min-width: 0; }
  .inbox-grid[data-mobile-view="list"] .thread-pane,
  .inbox-grid[data-mobile-view="thread"] .conversation-pane {
    visibility: hidden;
    pointer-events: none;
  }
}
```

Add short transform/opacity transitions only when reduced motion is not requested. Keep inactive panes outside pointer and accessibility interaction through `inert` in React, not CSS alone.

- [ ] **Step 5: Make conversation rows denser and legible**

Keep name, time, preview, unread and pin on the first two visual lines. Place responsible/type/tags into one compact metadata row with horizontal truncation; do not stack every chip. Preserve all accessible labels and the explicit pin action. Long names, phones and tags must use `min-width: 0`, `truncate` or `overflow-wrap` as appropriate.

- [ ] **Step 6: Preserve state through breakpoint changes**

Keep `mobileView`, selected ID, reply draft and DOM nodes mounted. Do not reset state in a resize effect. Update all mobile checks in `InboxShell` and `MessageReactions` to 767 px. Add a test that selects a conversation, rerenders after changing `matchMedia`, and keeps selection/draft/history content.

- [ ] **Step 7: Run responsive shell regressions and commit**

Run:

```powershell
npm test -- src/components/inbox/conversation-sidebar.test.tsx src/components/inbox/inbox-shell.test.tsx src/components/inbox/conversation-list.test.tsx src/hooks/use-mobile-inbox-history.test.tsx src/components/inbox/message-reactions.test.tsx
```

Expected: PASS; admin/attendant permissions, search, focus restoration and two mobile history layers remain intact.

```powershell
git add src/components/inbox/conversation-sidebar.tsx src/components/inbox/conversation-sidebar.test.tsx src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx src/components/inbox/conversation-list.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/message-reactions.tsx src/components/inbox/message-reactions.test.tsx src/hooks/use-mobile-inbox-history.ts src/hooks/use-mobile-inbox-history.test.tsx src/app/globals.css
git commit -m "feat: redesign the responsive inbox shell"
```

### Task 6: Adaptive thread header, timeline, and explicit message actions

**Files:**
- Create: `src/components/inbox/thread-header.tsx`
- Create: `src/components/inbox/thread-header.test.tsx`
- Create: `src/components/inbox/message-timeline.tsx`
- Create: `src/components/inbox/message-timeline.test.tsx`
- Create: `src/components/inbox/message-actions.tsx`
- Create: `src/components/inbox/message-actions.test.tsx`
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/conversation-view.test.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/message-bubble.test.tsx`
- Modify: `src/components/inbox/message-reactions.tsx`
- Modify: `src/components/inbox/message-reactions.test.tsx`
- Modify: `src/components/inbox/conversation-message-search.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- `ThreadHeader` keeps back, contact identity, unread, search and inspector actions.
- On mobile, only back, avatar/name, search and one `Mais opções` trigger remain in the header.
- `MessageActions` exposes reply and reaction by hover/focus desktop and by one explicit menu mobile.
- `MessageTimeline` keeps the existing log, scroll, media and search-target contracts.

- [ ] **Step 1: Write failing header tests**

Assert long contact names remain in a `min-w-0` heading container; all controls are 44 px; `Mais opções` contains `Marcar como não lida` and `Abrir dados do cliente`; the pending/error unread state remains announced; and desktop actions retain current accessible names.

- [ ] **Step 2: Write failing message-action tests**

Cover keyboard focus revealing desktop actions, a mobile `Ações da mensagem` button, menu items `Responder` and `Reagir`, quick emoji selection, focus restoration after close, no action for non-replyable/expired content, and retention of swipe-to-reply as an optional equivalent gesture.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
npm test -- src/components/inbox/thread-header.test.tsx src/components/inbox/message-actions.test.tsx src/components/inbox/message-bubble.test.tsx
```

Expected: new module imports fail and current mobile bubbles expose separate floating controls.

- [ ] **Step 4: Extract the thread header**

Move the existing `ConversationHeader` without changing async focus guards. Render secondary mobile actions in `DropdownMenu`; keep the search control as the single direct secondary icon. Use CSS to show full desktop actions at 768 px and above.

- [ ] **Step 5: Extract timeline presentation without moving scroll state**

Keep scrolling/search/media history state in `ConversationView` initially; `MessageTimeline` receives refs and mapped children so the extraction is presentational and reversible:

```ts
type MessageTimelineProps = {
  label: string;
  historyRef: RefObject<HTMLDivElement | null>;
  empty: boolean;
  children: ReactNode;
};
```

Add a subtle local background pattern using CSS gradients only. It must work in both themes, never be fetched remotely and remain low contrast.

- [ ] **Step 6: Implement one coherent `MessageActions` surface**

Move reply/reaction triggers out of the bubble margins. Desktop renders a compact toolbar on hover and `:focus-within`; mobile renders one always-visible 44 px trigger whose menu contains an explicit reply and quick reactions/full picker. Reaction badges remain attached to the bubble. Do not require long press or swipe for any action.

- [ ] **Step 7: Refine bubble geometry and status**

Use inbound/outbound variables, 12–14 px radii with directional corner detail, maximum width `min(78%, 42rem)` desktop and `min(86%, 36rem)` mobile. Keep failures, quoted replies, rich content, media and status copy. Long URLs/media must not overflow.

- [ ] **Step 8: Run the full thread component suite and commit**

Run:

```powershell
npm test -- src/components/inbox/thread-header.test.tsx src/components/inbox/message-timeline.test.tsx src/components/inbox/message-actions.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/message-bubble.test.tsx src/components/inbox/message-reactions.test.tsx src/components/inbox/message-media.test.tsx src/components/inbox/media-viewer-dialog.test.tsx src/hooks/use-message-reply-gesture.test.tsx
```

Expected: PASS; message search, media gallery, quoted replies, reactions, read tracking and browser-back media behavior remain intact.

```powershell
git add src/components/inbox/thread-header.tsx src/components/inbox/thread-header.test.tsx src/components/inbox/message-timeline.tsx src/components/inbox/message-timeline.test.tsx src/components/inbox/message-actions.tsx src/components/inbox/message-actions.test.tsx src/components/inbox/conversation-view.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/message-bubble.tsx src/components/inbox/message-bubble.test.tsx src/components/inbox/message-reactions.tsx src/components/inbox/message-reactions.test.tsx src/components/inbox/conversation-message-search.tsx src/app/globals.css
git commit -m "feat: refine responsive conversation interactions"
```

### Task 7: Safe-area composer and responsive contact inspector

**Files:**
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-composer.test.tsx`
- Modify: `src/components/inbox/quick-reply-menu.tsx`
- Modify: `src/components/inbox/customer-panel.tsx`
- Modify: `src/components/inbox/customer-panel.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`
- Modify: `src/components/ui/dialog.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Composer padding bottom includes `env(safe-area-inset-bottom)`.
- Composer remains visible with `100dvh`, does not force horizontal scroll, and gives text input the flexible width.
- Desktop contact inspector remains in the third pane; tablet/mobile use the same content in a focus-restoring drawer.

- [ ] **Step 1: Write failing layout contracts**

Assert the composer root has a stable class/data hook for safe-area styling, the textarea uses `bg-[var(--surface-elevated)]` instead of hard-coded white, attachment/record/send targets remain 44 px, and preview/audio/file states wrap below 390 px. Assert the inspector drawer title, close action, focus restoration and long contact/tag wrapping.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- src/components/inbox/message-composer.test.tsx src/components/inbox/customer-panel.test.tsx src/components/inbox/inbox-shell.test.tsx
```

Expected: safe-area/data-hook assertions fail.

- [ ] **Step 3: Implement safe-area and keyboard-safe composer CSS**

```css
.message-composer {
  padding: 0.625rem 0.75rem calc(0.625rem + env(safe-area-inset-bottom));
  background: var(--panel);
}

@media (max-width: 389px) {
  .message-composer__row { gap: 0.25rem; }
  .message-composer__field { min-width: 0; }
}
```

Use `position: relative`, not globally fixed, so the flex thread handles virtual-keyboard viewport resizing. Preserve every recorder and quick-reply focus contract.

- [ ] **Step 4: Refine inspector content**

Use a branded contact header, semantic sections with compact separators, masked/wrapped phone, type/tag text accompanying color, and full-width mobile action buttons where needed. Do not duplicate fetch/state logic between pane and drawer.

- [ ] **Step 5: Run composer, inspector, and audio regressions**

Run:

```powershell
npm test -- src/components/inbox/message-composer.test.tsx src/components/inbox/customer-panel.test.tsx src/components/inbox/inbox-shell.test.tsx src/hooks/use-audio-recorder.test.tsx
```

Expected: PASS; text, file, audio, reply draft, Escape and focus restoration all remain functional.

- [ ] **Step 6: Commit**

```powershell
git add src/components/inbox/message-composer.tsx src/components/inbox/message-composer.test.tsx src/components/inbox/quick-reply-menu.tsx src/components/inbox/customer-panel.tsx src/components/inbox/customer-panel.test.tsx src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx src/components/ui/dialog.tsx src/app/globals.css
git commit -m "feat: polish composer and contact inspector"
```

### Task 8: Responsive settings, login, legal, loading, and error surfaces

**Files:**
- Create: `src/components/users/responsive-settings-list.tsx`
- Create: `src/components/users/responsive-settings-list.test.tsx`
- Modify: `src/components/users/users-screen.tsx`
- Modify: `src/components/users/users-screen.test.tsx`
- Modify: `src/components/settings/contact-classification-screen.tsx`
- Modify: `src/components/settings/contact-classification-screen.test.tsx`
- Modify: `src/components/settings/quick-replies-screen.tsx`
- Modify: `src/components/settings/quick-replies-screen.test.tsx`
- Modify: `src/components/meta-health/meta-health-screen.tsx`
- Modify: `src/components/meta-health/meta-health-screen.test.tsx`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/login/page.test.tsx`
- Modify: `src/components/auth/login-form.tsx`
- Modify: `src/components/auth/login-form.test.tsx`
- Modify: `src/components/legal/legal-document.tsx`
- Modify: `src/app/legal-pages.test.tsx`
- Modify: `src/app/error.tsx`
- Modify: `src/app/not-found.tsx`
- Modify: `src/app/error-states.test.tsx`
- Modify: `src/app/configuracoes/atendimento/loading.tsx`
- Modify: `src/app/configuracoes/atendimento/error.tsx`
- Modify: `src/app/configuracoes/meta/loading.tsx`
- Modify: `src/app/configuracoes/meta/error.tsx`
- Modify: `src/app/configuracoes/respostas-rapidas/loading.tsx`
- Modify: `src/app/configuracoes/respostas-rapidas/error.tsx`
- Modify: `src/app/configuracoes/usuarios/loading.tsx`
- Modify: `src/app/configuracoes/usuarios/error.tsx`

**Interfaces:**
- Users: semantic desktop table at 768 px and above; semantic mobile cards below 768 px; no horizontal scroll.
- All administrative pages consume `SettingsPageShell` and keep authorization/behavior unchanged.
- Login and public/error surfaces consume `AppBrand` and `ThemeMenu` without requiring authentication.

- [ ] **Step 1: Write failing responsive users tests**

Require a table view with the existing columns and a mobile list/card view containing name, email, profile, status and all allowed actions. Assert both representations omit delete, the current admin cannot deactivate themself, and the mobile wrapper has no `min-w-[760px]`/`overflow-x-auto` contract.

- [ ] **Step 2: Run the users suite and verify RED**

Run: `npm test -- src/components/users/responsive-settings-list.test.tsx src/components/users/users-screen.test.tsx`

Expected: new component missing and old horizontal table contract detected.

- [ ] **Step 3: Implement `ResponsiveSettingsList`**

Render two synchronized semantic representations from the same user array and callbacks:

```tsx
<div className="hidden md:block">{/* table */}</div>
<ul aria-label="Funcionários" className="grid gap-3 md:hidden">{/* cards */}</ul>
```

Cards place identity first, text status/profile second and labeled 44 px actions last. Avoid JS breakpoint state so dialogs and mutations survive rotation/resizing.

- [ ] **Step 4: Adopt the shared settings shell**

Migrate Users, Classifications, Quick Replies and Meta Health to `SettingsPageShell`. Keep every route-specific action, error message, focus return, live toast and permission restriction. Convert centered dialogs to `.modal-dialog` and ensure action rows stack below 390 px.

- [ ] **Step 5: Redesign login without changing authentication**

Use a two-area composition above 900 px and one compact card below it. Include the local XP symbol/wordmark, a restrained brand gradient, an operational value statement, theme menu and existing legal links. The form keeps the same labels, autocomplete, submit behavior and public error handling. On error, move focus to the alert or first invalid field without clearing typed email.

- [ ] **Step 6: Bring public/legal/error/loading states into the same system**

Replace hard-coded top borders and neutral slabs with shared brand/surface tokens, local brand, theme control where appropriate and responsive padding. Do not reveal error objects. Loading states use geometry-compatible skeletons or the existing named spinner, never unlabeled animation.

- [ ] **Step 7: Run all non-inbox frontend tests and commit**

Run:

```powershell
npm test -- src/components/users/users-screen.test.tsx src/components/users/responsive-settings-list.test.tsx src/components/settings/contact-classification-screen.test.tsx src/components/settings/quick-replies-screen.test.tsx src/components/meta-health/meta-health-screen.test.tsx src/app/login/page.test.tsx src/components/auth/login-form.test.tsx src/app/legal-pages.test.tsx src/app/error-states.test.tsx
```

Expected: PASS; no role/name/authorization regression.

```powershell
git add src/components/users src/components/settings src/components/meta-health/meta-health-screen.tsx src/components/meta-health/meta-health-screen.test.tsx src/app/login/page.tsx src/app/login/page.test.tsx src/components/auth/login-form.tsx src/components/auth/login-form.test.tsx src/components/legal/legal-document.tsx src/app/legal-pages.test.tsx src/app/error.tsx src/app/not-found.tsx src/app/error-states.test.tsx src/app/configuracoes
git commit -m "feat: redesign settings and public screens"
```

### Task 9: Full frontend regression, accessibility, responsiveness, and PWA verification

**Files:**
- Create: `src/responsive-pwa-release.test.ts`
- Create: `docs/verification/2026-08-24-responsive-pwa-redesign.md`
- Create: `docs/verification/screenshots/2026-08-24-responsive-pwa/*`
- Modify: implementation files only for defects proven by this gate.

**Interfaces:**
- Produces: one source-level release contract ensuring theme, manifest, breakpoints, mobile cards and no service worker coexist.
- Produces: local visual evidence for every required viewport/theme without real customer data.

- [ ] **Step 1: Add a combined release contract**

Use file reads similar to existing integrated release tests. Require `ThemeProvider`, `manifest`, `standalone`, `xp-maskable-512.png`, `max-width: 767px`, the desktop clamp values, `ResponsiveSettingsList`, `safe-area-inset-bottom`, and absence of `public/sw.js`/Workbox registration.

- [ ] **Step 2: Run focused and repository-wide automated gates**

Run in this order:

```powershell
npm run icons:generate
npm test -- src/responsive-pwa-release.test.ts
npm run lint
npm run typecheck
npm run db:validate
npm test
npm run build
git diff --check
```

Expected: every command exits 0; build emits `/manifest.webmanifest`; no frontend or backend regression test fails.

- [ ] **Step 3: Serve the exact production build locally**

Run `npm run start` with the existing safe local environment and a non-production database. Verify `/login`, `/conversas` after login, `/manifest.webmanifest` and every declared icon respond successfully. Do not point local tests to the production database.

- [ ] **Step 4: Execute the visual viewport matrix in both themes**

Using the browser-control skill on the production build and synthetic data, verify and capture:

- `320x568`, `390x844`: list, thread, message menu, composer, client drawer, login, users cards;
- `768x1024`, `900x1100`, `1024x768`: two-pane inbox and client drawer;
- `1280x800`, `1440x900`: full three-pane inbox, users table and settings;
- light and dark modes, plus one `system` transition;
- empty, loading, retry and reconnect states;
- long names/URLs, tags, rich messages, reply, reactions, send failure, image/audio/video/PDF/document.

Store only synthetic captures under `docs/verification/screenshots/2026-08-24-responsive-pwa/` with descriptive names. At each width assert `document.documentElement.scrollWidth === document.documentElement.clientWidth` unless a component intentionally owns internal horizontal media controls.

- [ ] **Step 5: Run accessibility and installability checks**

Verify complete keyboard flows, visible focus, Escape/back layering, focus restoration, 200% zoom, reduced motion, theme contrast and named live regions. Run Lighthouse accessibility/best-practices audits on login and the authenticated inbox with the browser's local profile; target no accessibility failure and investigate every remaining manual item.

In a fresh Chromium/Edge profile, inspect Application → Manifest, confirm all icons load, `display: standalone`, `start_url`, scope and no registered service worker/cache. Confirm the native install action appears over HTTPS or the browser documents the platform-specific Add to Home Screen path. Do not introduce a cache merely to satisfy a deprecated PWA score.

- [ ] **Step 6: Smoke all existing functional flows**

With synthetic records: login/logout, list search, message search, open/back, details, responsible/type/tags, send text, file, recording, reply, retry, reaction, gallery, pin/unread, settings mutations, SSE reconnect and Meta health. Check console and failed network requests after each family.

- [ ] **Step 7: Record factual evidence and commit**

Write test counts, build result, viewport/theme matrix, Lighthouse results, manifest/icon checks, no-service-worker proof, console/network status and any accepted non-blocking limitation. Never record credentials, tokens, customer names, phones or message bodies.

```powershell
git add src/responsive-pwa-release.test.ts docs/verification/2026-08-24-responsive-pwa-redesign.md docs/verification/screenshots/2026-08-24-responsive-pwa
git commit -m "test: verify responsive XP PWA redesign"
```

### Task 10: Immutable production release and install verification

**Files:**
- Modify: `docs/verification/2026-08-24-responsive-pwa-redesign.md` with production evidence.
- Modify implementation only if a production-only defect is reproduced locally and separately fixed/tested.

**Interfaces:**
- Consumes: the exact verified Git revision and existing `/opt/apps/example-app/.env.production`.
- Produces: healthy `https://whatsapp.xpeletronicos.com` with app-only rollback to the previous immutable image.

- [ ] **Step 1: Audit all concurrent work immediately before release**

Run:

```powershell
git worktree list --porcelain
git status --short --branch
git log --all --decorate --oneline --graph -40
git diff --check
```

Inspect every worktree status and compare its head with the live release. Merge only completed/tested work that must be in production; after any integration, rerun all commands from Task 9 Step 2 and the affected browser matrix.

- [ ] **Step 2: Build and validate an immutable Linux image**

Create a release directory from the exact Git archive on the KVM. Build `xp-whatsapp:$REVISION`, label it with the full revision, and run the complete test suite against an isolated PostgreSQL 18 database under the established CPU/RAM constraints. Verify `public/icons`, `manifest.webmanifest` build output, FFmpeg/FFprobe/Poppler, non-root UID 1001 and absence of runtime `.env` or test source.

- [ ] **Step 3: Back up production and snapshot invariants**

Run the existing validated backup script to a new `/srv/backups/example-app/...` directory. Record the database container ID/StartedAt, deterministic non-app container snapshot, networks, volumes, current symlink, current immutable image and rollback revision. Abort before deployment if backup validation or invariants fail.

- [ ] **Step 4: Deploy only the application container**

Update only `XP_WHATSAPP_IMAGE` to the new immutable tag, atomically point `current` to the new release and run:

```sh
docker compose \
  --project-directory "$CANDIDATE" \
  --env-file /opt/apps/example-app/.env.production \
  -f deploy/kvm/docker-compose.yml \
  up -d --no-deps --force-recreate app
```

Expected: only `xp-whatsapp-app` receives a new container ID; it becomes healthy with zero restarts. Database, media, proxy, site, networks and volumes remain byte-for-byte/invariant-identical.

- [ ] **Step 5: Verify public production behavior**

Check local and public health, login, authenticated inbox, SSE, settings authorization, `/manifest.webmanifest`, every icon, light/dark theme, 320/390/900/1440 layouts and browser console. In a fresh browser profile, confirm native installation and launch the installed app; verify it opens `/conversas` in standalone chrome and still requires a valid online session.

Do not capture or commit live chat content. Use DOM/layout assertions and redacted notes only.

- [ ] **Step 6: Soak, rollback if necessary, and record the release**

Take at least three health/log samples separated by 20 seconds. Roll back app-only to the previous immutable digest on any health, migration, manifest, authentication, SSE or critical UI failure. Preserve additive assets and do not revert database/volumes.

Append exact revision, image digest, prior rollback image, backup path, test counts, container invariants, endpoint results, install verification and soak samples to the verification document.

```powershell
git add docs/verification/2026-08-24-responsive-pwa-redesign.md
git commit -m "docs: record responsive PWA production release"
```

## Acceptance Coverage

| Approved acceptance criterion | Planned proof |
| --- | --- |
| 1. All screens work from 320 to 1440 px without unintended horizontal scrolling | Tasks 5–9; viewport matrix plus `scrollWidth === clientWidth` assertion |
| 2. Approved desktop, tablet, and mobile compositions | Tasks 5–7; boundary component tests and screenshots |
| 3. Users do not use a horizontally scrolling mobile table | Task 8; `ResponsiveSettingsList` contract and 320/390 captures |
| 4. Header and composer handle virtual keyboard and safe areas | Tasks 6–7; 320/390 browser checks and safe-area source contract |
| 5. Light, dark, and system persist without flash | Tasks 1–3 and 9; bootstrap/provider tests and first-paint browser check |
| 6. WCAG 2.2 AA contrast and keyboard navigation | Tasks 3, 6–9; component focus tests, keyboard pass and Lighthouse accessibility audit |
| 7. Updates never erase existing content | Task 4; deferred realtime success/failure tests |
| 8. Manifest and icons support standalone installation over HTTPS | Tasks 2, 9–10; manifest test, public endpoint checks and real install/launch |
| 9. No private content is available offline | Tasks 2, 9–10; no-service-worker/cache contract and fresh-profile inspection |
| 10. Tests, lint, typecheck, build, and audits pass | Task 9 automated/visual gate |
| 11. Existing attendance flows remain functional | Tasks 4–9; focused regression suites and end-to-end smoke |
| 12. Production passes smoke and has a verified rollback | Task 10; immutable image, backup, invariants, soak and rollback record |

## Completion Checklist

- [ ] Every task checkbox is updated with factual results.
- [ ] No unresolved implementation marker, temporary brand asset, remote logo URL or hard-coded light-only surface remains.
- [ ] Theme types are consistent from pure contract through menu, bootstrap and metadata.
- [ ] All 12 acceptance criteria from the approved spec have direct automated or recorded evidence.
- [ ] No private production content is present in Git history or screenshots.
- [ ] Production has a verified immutable rollback image and validated backup.
