import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("integrated messaging release", () => {
  it("contains message search, quoted replies, and reactions in the same source tree", () => {
    expect(source("src/components/inbox/inbox-shell.tsx")).toContain("MessageSearchResults");
    expect(source("src/components/inbox/thread-header.tsx")).toContain("ConversationMessageSearch");
    expect(source("src/components/inbox/message-bubble.tsx")).toContain("QuotedReplyPreview");
    expect(source("src/components/inbox/message-bubble.tsx")).toContain("MessageReactions");
    expect(source("src/modules/messages/service.ts")).toContain("replyToMessageId");
    expect(source("src/modules/reactions/service.ts")).toContain("sendReaction");
    expect(source("prisma/migrations/202608220003_message_search/migration.sql")).toContain("pg_trgm");
    expect(source("prisma/migrations/202608220004_quoted_replies/migration.sql")).toContain("reply_to_message_id");
    expect(source("prisma/migrations/202608220005_message_reactions/migration.sql")).toContain("message_reactions");
  });

  it("ships shared official read receipts as one release", () => {
    expect(
      source(
        "prisma/migrations/202608230002_whatsapp_read_receipts/migration.sql",
      ),
    ).toContain('CREATE TABLE "whatsapp_read_sync"');
    expect(source("src/modules/whatsapp/provider.ts")).toContain(
      "markRead(input: { messageId: string }): Promise<void>",
    );
    expect(source("src/modules/conversations/shared-state.ts")).toContain(
      "queueEligibleReadTarget",
    );
    expect(source("src/instrumentation.ts")).toContain(
      "startReadReceiptWorker",
    );
  });
});
