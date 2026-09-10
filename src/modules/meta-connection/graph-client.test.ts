// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMetaConnectionClient } from "./graph-client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const config = { appId: "100", appSecret: "server-secret", accessToken: "permanent-token", businessId: "400", wabaId: "200", phoneNumberId: "300", graphVersion: "v23.0", timeoutMs: 200 };
const debug = { data: { app_id: "100", is_valid: true, expires_at: 0, scopes: ["whatsapp_business_management", "whatsapp_business_messaging"] } };
const owner = { id: "200", owner_business_info: { id: "400" } };

describe("reconnection Graph client", () => {
  it("exchanges a code on the server and validates app, business and phone ownership", async () => {
    const replies = [{ access_token: "temporary-token" }, debug, owner, { data: [{ id: "300" }] }];
    const fetcher = vi.fn<typeof fetch>(async () => json(replies.shift()));
    await createMetaConnectionClient({ ...config, fetcher }).exchangeCode("one-use-code");
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).not.toContain("one-use-code");
    expect(options?.method).toBe("POST");
    expect(String(options?.body)).toContain("code=one-use-code");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.every(([, init]) => init?.redirect === "error" && init.cache === "no-store")).toBe(true);
  });

  it.each([
    { ...debug, data: { ...debug.data, app_id: "999" } },
    { ...debug, data: { ...debug.data, is_valid: false } },
    { ...debug, data: { ...debug.data, scopes: [] } },
  ])("rejects an unauthorized temporary grant", async (invalid) => {
    const replies = [{ access_token: "private-temporary-token" }, invalid];
    const fetcher = vi.fn<typeof fetch>(async () => json(replies.shift()));
    await expect(createMetaConnectionClient({ ...config, fetcher }).exchangeCode("private-code")).rejects.toMatchObject({ code: "TOKEN_INVALID" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects a foreign business before subscribing any account", async () => {
    const replies = [{ access_token: "temporary-token" }, debug, { id: "200", owner_business_info: { id: "999" } }];
    const fetcher = vi.fn<typeof fetch>(async () => json(replies.shift()));
    await expect(createMetaConnectionClient({ ...config, fetcher }).exchangeCode("code")).rejects.toMatchObject({ code: "ASSET_MISMATCH" });
    expect(fetcher.mock.calls.slice(1).every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("checks physical connection and both subscription layers with the permanent credential", async () => {
    const replies = [
      { id: "300", status: "CONNECTED", platform_type: "CLOUD_API", is_on_biz_app: true },
      { data: [{ whatsapp_business_api_data: { id: "100" } }] },
      { data: [{ object: "whatsapp_business_account", active: true, fields: ["messages", "account_update", "smb_message_echoes", "smb_app_state_sync"].map((name) => ({ name })) }] },
    ];
    const fetcher = vi.fn<typeof fetch>(async () => json(replies.shift()));
    await expect(createMetaConnectionClient({ ...config, fetcher }).verifyConnection()).resolves.toEqual({ connection: { status: "CONNECTED", platformType: "CLOUD_API", isOnBizApp: true }, subscribed: true });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer permanent-token");
  });

  it("never exposes provider response text or tokens in an error", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ error: { message: "private-token-and-user-data" } }, 400));
    await expect(createMetaConnectionClient({ ...config, fetcher }).exchangeCode("secret-code")).rejects.toMatchObject({ message: "META_INVALID_RESPONSE" });
  });
});
