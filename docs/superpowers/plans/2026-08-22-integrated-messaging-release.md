# Integrated Messaging Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one immutable production revision that contains both message search and WhatsApp quoted replies.

**Architecture:** Merge quoted-reply revision `119848c02f94f62c92eef126d5311db503ca71bb` into the message-search branch, resolving the four overlapping inbox components by composition. Protect the combined release with an artifact contract, then build, back up, migrate, deploy only the app container, and verify both feature families in the running image.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Prisma 7, PostgreSQL 18, Docker Compose, Caddy.

## Global Constraints

- Work inline in the existing worktree; do not use subagents.
- Preserve all message-search and quoted-reply behavior.
- Do not modify production data except through the already-defined idempotent Prisma migrations.
- Create a validated database and media backup before replacing the app container.
- Keep the production database container, volumes, networks, and port binding unchanged.

---

### Task 1: Add a combined-release regression contract

**Files:**
- Create: `src/integrated-messaging-release.test.ts`

**Interfaces:**
- Consumes: repository source tree and Prisma migrations.
- Produces: a regression test that fails whenever either search or quoted-reply artifacts disappear from a release branch.

- [ ] **Step 1: Write the failing contract test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("integrated messaging release", () => {
  it("contains message search and quoted replies in the same source tree", () => {
    expect(source("src/components/inbox/inbox-shell.tsx")).toContain("MessageSearchResults");
    expect(source("src/components/inbox/conversation-view.tsx")).toContain("ConversationMessageSearch");
    expect(source("src/components/inbox/message-bubble.tsx")).toContain("QuotedReplyPreview");
    expect(source("src/modules/messages/service.ts")).toContain("replyToMessageId");
    expect(source("prisma/migrations/202608220003_message_search/migration.sql")).toContain("pg_trgm");
    expect(source("prisma/migrations/202608220004_quoted_replies/migration.sql")).toContain("reply_to_message_id");
  });
});
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `npx vitest run src/integrated-messaging-release.test.ts`

Expected: FAIL because the current search branch does not yet contain `QuotedReplyPreview`, `replyToMessageId`, or migration `202608220004_quoted_replies`.

- [ ] **Step 3: Commit the red contract**

```powershell
git add src/integrated-messaging-release.test.ts
git commit -m "test: require integrated messaging features"
```

### Task 2: Merge and compose both inbox feature sets

**Files:**
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/message-bubble.test.tsx`
- Merge automatically: all other files changed by `119848c02f94f62c92eef126d5311db503ca71bb`

**Interfaces:**
- Consumes: `ConversationMessageSearch`, `MessageSearchResults`, `QuotedReplyPreview`, reply gesture callbacks, `useInbox.loadMessageContext`.
- Produces: one inbox in which search targeting and quoted replies operate independently on the same messages.

- [ ] **Step 1: Merge the quoted-reply revision without committing**

Run: `git merge --no-ff --no-commit 119848c02f94f62c92eef126d5311db503ca71bb`

Expected: conflicts only in the four listed overlapping component/test files; other search and reply files merge automatically.

- [ ] **Step 2: Resolve `conversation-view.tsx` by composition**

Keep both interfaces in the resolved component:

```ts
type ConversationViewProps = {
  conversation: ConversationDto | null;
  messages: MessageDto[];
  highlightedMessageId?: string | null;
  onSearchTarget?: (result: MessageSearchResultDto) => void;
  onReplyToMessage?: (message: MessageDto) => void;
};
```

Render `ConversationMessageSearch` above the message viewport when `conversation` and `onSearchTarget` exist. Pass `highlightedMessageId` and `onReplyToMessage` through every `MessageBubble` while preserving the reply composer preview supplied by the quoted-reply branch.

- [ ] **Step 3: Resolve `inbox-shell.tsx` by composition**

Keep the global `searchMode`, `useMessageSearch`, `MessageSearchResults`, context loading, exact-message highlight, and the quoted-reply draft state. Selecting a global search result must load its conversation/context without clearing read state; selecting Reply must set the reply draft without changing search mode.

- [ ] **Step 4: Resolve `message-bubble.tsx` and its test**

Keep both independent visual states:

```tsx
<article
  className={cn("message-bubble", isHighlighted && "message-bubble--highlighted")}
  data-message-id={message.id}
>
  {message.replyTo ? <QuotedReplyPreview message={message.replyTo} /> : null}
  {/* existing rich content, media, status, and reply gesture/button */}
</article>
```

Combine the search-highlight assertions with the quoted-preview and reply-action assertions in `message-bubble.test.tsx`.

- [ ] **Step 5: Verify GREEN with focused integration tests**

Run:

```powershell
npx vitest run src/integrated-messaging-release.test.ts src/components/inbox/inbox-shell.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/message-bubble.test.tsx src/components/inbox/message-composer.test.tsx src/components/inbox/quoted-reply-preview.test.tsx src/hooks/use-inbox.test.tsx src/hooks/use-message-search.test.tsx src/hooks/use-message-reply-gesture.test.tsx src/modules/message-search/service.test.ts src/modules/messages/reply-context.test.ts
```

Expected: all selected test files and tests PASS.

- [ ] **Step 6: Commit the merge**

```powershell
git add src prisma scripts docs README.md .gitattributes
git commit -m "merge: integrate search and quoted replies"
```

### Task 3: Run the complete release gate

**Files:**
- Modify only if a combined test reveals an integration defect in the files from Task 2.

**Interfaces:**
- Consumes: merged source tree.
- Produces: a production-buildable, migration-compatible release revision.

- [ ] **Step 1: Generate Prisma and run static checks**

Run:

```powershell
npm run db:generate
npm run lint
npm run typecheck
npm run db:validate
git diff --check
```

Expected: every command exits 0 with no lint, type, schema, or whitespace errors.

- [ ] **Step 2: Run all tests against isolated PostgreSQL 18 with FFmpeg**

Build the Docker builder target from the exact merged revision, create a uniquely named disposable PostgreSQL 18 network/container, run `npx prisma migrate deploy && npm test`, and remove those exact temporary resources with a shell trap.

Expected: all migrations apply, all test files pass, zero failed tests, and the disposable resources are removed.

- [ ] **Step 3: Build the immutable production image**

Run on the KVM release directory:

```sh
docker build \
  --label org.opencontainers.image.revision="$REVISION" \
  -t "xp-whatsapp:$SHORT_REVISION" .
```

Expected: exit 0; image label equals the full revision; configured user is `nextjs`; FFmpeg and both migration directories exist inside the image.

### Task 4: Back up, deploy, and prove the combined production release

**Files:**
- Create: `docs/verification/2026-08-22-integrated-messaging-release.md`

**Interfaces:**
- Consumes: immutable image and `/opt/apps/example-app/.env.production`.
- Produces: healthy production at `https://whatsapp.xpeletronicos.com` with both feature families.

- [ ] **Step 1: Create and validate the production backup**

Run from the current release:

```sh
./scripts/backup.sh /srv/backups/example-app \
  --env-file /opt/apps/example-app/.env.production
```

Expected: prints one new validated backup path containing non-empty database and media archives plus checksums.

- [ ] **Step 2: Deploy only the app container**

Record the database container ID and `StartedAt`, update `XP_WHATSAPP_IMAGE` to the immutable integrated tag, atomically update `/opt/apps/example-app/current`, run `prisma migrate deploy`, and execute:

```sh
docker compose \
  --project-directory "$CANDIDATE" \
  --env-file /opt/apps/example-app/.env.production \
  -f deploy/kvm/docker-compose.yml \
  up -d --no-deps --force-recreate app
```

Expected: app becomes healthy; database identity and start time remain unchanged. On failure, restore revision `119848c02f94f62c92eef126d5311db503ca71bb`.

- [ ] **Step 3: Verify the live artifact and endpoints**

Inside `xp-whatsapp-app`, assert that compiled output contains `Buscar nas mensagens` and `QuotedReplyPreview`-related code, and that both migrations exist. Verify local/public health 200, login 200, unauthenticated conversations 307, invalid webhook 401, zero restarts, expected networks, no recent fatal/error logs, and three healthy samples spaced by 10 seconds.

- [ ] **Step 4: Record and commit evidence**

Write exact revision, image, backup path, test counts, migration status, container identity, route results, artifact checks, soak samples, and any infrastructure caveat to `docs/verification/2026-08-22-integrated-messaging-release.md`.

```powershell
git add docs/verification/2026-08-22-integrated-messaging-release.md
git commit -m "docs: verify integrated messaging production release"
```
