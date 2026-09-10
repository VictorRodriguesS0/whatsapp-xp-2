import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetTestDatabase } from "@/test/database";
import { createMetaConnectionService } from "./service";

const now = new Date("2026-09-10T12:00:00Z");
const config = { enabled: true, appId: "100", configId: "500", phoneNumberId: "300", wabaId: "200", businessId: "400", sdkVersion: "v26.0", appUrl: "https://example.test" };

async function setup() {
  const user = await prisma.user.create({ data: { name: "Admin", email: "admin@example.test", passwordHash: "unused", role: "ADMIN" } });
  const actor = { user, sessionHash: "session-one" };
  const client = {
    exchangeCode: vi.fn(async (_code: string): Promise<void> => undefined),
    ensureSubscription: vi.fn(async () => undefined),
    verifyConnection: vi.fn(async () => ({ connection: { status: "CONNECTED", platformType: "CLOUD_API", isOnBizApp: true }, subscribed: true })),
  };
  let time = now;
  const service = createMetaConnectionService({ config, client, now: () => time });
  return { actor, client, service, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}

describe("Meta reconnection attempts", () => {
  beforeEach(resetTestDatabase);

  it("exchanges immediately even if session information has not arrived and never stores the code", async () => {
    const { actor, service, client } = await setup();
    const attempt = await service.start(actor);
    await service.exchange(actor, { ...attempt, code: "private-oauth-code" });
    expect(client.exchangeCode).toHaveBeenCalledWith("private-oauth-code");
    expect((await service.status(actor, attempt.id)).state).toBe("VERIFYING");
    await service.reconcile(actor, attempt);
    expect(client.verifyConnection).not.toHaveBeenCalled();
    expect(JSON.stringify(await prisma.metaConnectionAttempt.findMany())).not.toContain("private-oauth-code");
    await service.finish(actor, { ...attempt, wabaId: "200" });
    await service.reconcile(actor, attempt);
    expect((await service.status(actor, attempt.id)).state).toBe("CONNECTED");
  });

  it("supports session information arriving before the OAuth code", async () => {
    const { actor, service } = await setup();
    const attempt = await service.start(actor);
    await service.finish(actor, { ...attempt, wabaId: "200", phoneNumberId: "300", businessId: "400" });
    await service.exchange(actor, { ...attempt, code: "private-code" });
    await service.reconcile(actor, attempt);
    expect((await service.status(actor, attempt.id)).state).toBe("CONNECTED");
  });

  it("allows only one concurrent attempt and one exchange for a code", async () => {
    const { actor, service, client } = await setup();
    const results = await Promise.allSettled([service.start(actor), service.start(actor)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const attempt = results.find((result) => result.status === "fulfilled")!.value;
    await Promise.allSettled([service.exchange(actor, { ...attempt, code: "one-code" }), service.exchange(actor, { ...attempt, code: "one-code" })]);
    expect(client.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it("rejects other sessions, wrong nonces, expired attempts and attendants", async () => {
    const state = await setup();
    const attempt = await state.service.start(state.actor);
    await expect(state.service.exchange({ ...state.actor, sessionHash: "other-session" }, { ...attempt, code: "secret" })).rejects.toMatchObject({ status: 404 });
    await expect(state.service.exchange(state.actor, { ...attempt, nonce: "x".repeat(43), code: "secret" })).rejects.toMatchObject({ status: 403 });
    await expect(state.service.start({ ...state.actor, user: { ...state.actor.user, role: "ATTENDANT" } })).rejects.toMatchObject({ status: 403 });
    state.advance(16 * 60_000);
    await expect(state.service.exchange(state.actor, { ...attempt, code: "secret" })).rejects.toMatchObject({ status: 409 });
    expect(state.client.exchangeCode).not.toHaveBeenCalled();
  });

  it("fails a different account selection without starting any subscription", async () => {
    const { actor, service, client } = await setup();
    const attempt = await service.start(actor);
    await service.finish(actor, { ...attempt, wabaId: "999" });
    await expect(service.exchange(actor, { ...attempt, code: "secret" })).rejects.toMatchObject({ status: 409 });
    expect(client.ensureSubscription).not.toHaveBeenCalled();
    expect((await service.status(actor, attempt.id)).errorCode).toBe("ASSET_MISMATCH");
  });

  it("keeps verification pending while the phone is offline and does not retry OAuth after a network error", async () => {
    const { actor, service, client } = await setup();
    client.verifyConnection.mockResolvedValue({ connection: { status: "DISCONNECTED", platformType: "ON_PREMISE", isOnBizApp: true }, subscribed: true });
    const attempt = await service.start(actor);
    await service.exchange(actor, { ...attempt, code: "secret" });
    await service.finish(actor, { ...attempt, wabaId: "200" });
    await service.reconcile(actor, attempt);
    expect((await service.status(actor, attempt.id)).state).toBe("VERIFYING");
    expect((await prisma.metaHealthSnapshot.findUniqueOrThrow({ where: { phoneNumberId: "300" } })).connectionState).toBe("DISCONNECTED");
    await expect(service.exchange(actor, { ...attempt, code: "secret" })).rejects.toMatchObject({ status: 409 });
    expect(client.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it("does not accept an in-flight exchange after cancellation", async () => {
    const { actor, service, client } = await setup();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    client.exchangeCode.mockImplementation(() => blocked);
    const attempt = await service.start(actor);
    const exchange = service.exchange(actor, { ...attempt, code: "secret" });
    await vi.waitFor(() => expect(client.exchangeCode).toHaveBeenCalled());
    await service.cancel(actor, attempt.id);
    release();
    await exchange;
    expect((await service.status(actor, attempt.id)).state).toBe("CANCELLED");
    expect(client.ensureSubscription).not.toHaveBeenCalled();
  });
});

it("keeps the snapshot and sends blocked if either webhook subscription is missing", async () => {
  await resetTestDatabase();
  const { actor, service, client } = await setup();
  client.verifyConnection.mockResolvedValue({ connection: { status: "CONNECTED", platformType: "CLOUD_API", isOnBizApp: true }, subscribed: false });
  const attempt = await service.start(actor);
  await service.exchange(actor, { ...attempt, code: "test-code" });
  await service.finish(actor, { ...attempt, wabaId: "200" });
  await service.reconcile(actor, attempt);
  expect((await service.status(actor, attempt.id))).toMatchObject({ state: "VERIFYING", errorCode: "WEBHOOK_CONFIGURATION_REQUIRED" });
  expect((await prisma.metaHealthSnapshot.findUniqueOrThrow({ where: { phoneNumberId: "300" } })).connectionState).toBe("DISCONNECTED");
});
