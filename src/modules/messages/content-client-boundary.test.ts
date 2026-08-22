import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

it("keeps the shared message-content contract free of server-only Prisma imports", async () => {
  const source = await readFile("src/modules/messages/content.ts", "utf8");

  expect(source).not.toContain("@/generated/prisma/client");
  expect(source).not.toContain("messageContentForPrisma");
});
