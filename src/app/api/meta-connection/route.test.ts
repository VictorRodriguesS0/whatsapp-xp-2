// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
import { createMetaConnectionHandlers } from "./route";

const actor = { user: { id: "10000000-0000-4000-8000-000000000001", name: "Admin", email: "a@example.test", role: "ADMIN" as const }, sessionHash: "session" };
const attempt = { id: "20000000-0000-4000-8000-000000000001", state: "WAITING" as const, expiresAt: "2026-09-10T13:00:00Z", errorCode: null };
const config = { enabled: true, reason: null, appId: "100", configId: "500", sdkVersion: "v26.0" };
function setup() {
  const service = {
    status: vi.fn(async () => attempt), latest: vi.fn(async () => attempt),
    start: vi.fn(async () => ({ ...attempt, nonce: "a".repeat(43) })),
    exchange: vi.fn(async () => attempt), finish: vi.fn(async () => attempt),
    reconcile: vi.fn(async () => attempt), cancel: vi.fn(async () => attempt),
  };
  const auth = vi.fn(async () => actor);
  const origin = vi.fn((request: Request) => { if (request.headers.get("origin") !== "https://example.test") throw new HttpError(403, "Origem inválida"); });
  const handlers = createMetaConnectionHandlers({ actor: auth, assertSameOrigin: origin, service: () => service, config: () => config });
  return { handlers, service, auth };
}
const request = (body: unknown, origin = "https://example.test") => new Request("https://example.test/api/meta-connection", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });

describe("admin reconnection API", () => {
  it("checks origin and authentication before processing a code", async () => {
    const { handlers, service, auth } = setup();
    const body = { action: "exchange", id: attempt.id, nonce: "a".repeat(43), code: "private-code" };
    expect((await handlers.POST(request(body, "https://unrelated.test"))).status).toBe(403);
    auth.mockRejectedValue(new HttpError(401, "Não autenticado"));
    expect((await handlers.POST(request(body))).status).toBe(401);
    expect(service.exchange).not.toHaveBeenCalled();
  });
  it("passes codes immediately to the server service and disables response caching", async () => {
    const { handlers, service } = setup();
    const response = await handlers.POST(request({ action: "exchange", id: attempt.id, nonce: "a".repeat(43), code: "private-code" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(service.exchange).toHaveBeenCalledWith(actor, expect.objectContaining({ code: "private-code" }));
    expect(await response.text()).not.toContain("private-code");
  });
  it("rejects unknown properties and oversized bodies", async () => {
    const { handlers, service } = setup();
    expect((await handlers.POST(request({ action: "start", access_token: "not-accepted" }))).status).toBe(400);
    expect((await handlers.POST(request({ action: "exchange", code: "x".repeat(40_000) }))).status).toBe(413);
    expect(service.start).not.toHaveBeenCalled();
  });
  it("makes status reads without initiating provider work", async () => {
    const { handlers, service } = setup();
    const response = await handlers.GET();
    expect(await response.json()).toEqual({ config, attempt });
    expect(service.exchange).not.toHaveBeenCalled();
    expect(service.reconcile).not.toHaveBeenCalled();
  });
});
