import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

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
