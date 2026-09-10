import { describe, expect, it, vi } from "vitest";
import { withConnectionGuard } from "./connection-guard";
import { DemoWhatsAppProvider } from "./demo-provider";

describe("provider connection guard", () => {
  it.each(["sendText", "sendTemplate", "sendMedia", "uploadMedia", "sendProduct", "sendProductList", "sendCatalog", "sendReaction", "markRead"] as const)("blocks %s before entering the transport", async (method) => {
    const provider = new DemoWhatsAppProvider();
    const original = vi.spyOn(provider, method);
    const wrapped = withConnectionGuard(provider, async () => { throw new Error("disconnected"); });
    await expect((wrapped[method] as (input: never) => Promise<unknown>)({} as never)).rejects.toMatchObject({ kind: "rejected" });
    expect(original).not.toHaveBeenCalled();
  });

  it("keeps template listing available", async () => {
    const provider = new DemoWhatsAppProvider();
    const wrapped = withConnectionGuard(provider, async () => { throw new Error("disconnected"); });
    await expect(wrapped.listTemplates()).resolves.toBeInstanceOf(Array);
  });
});
