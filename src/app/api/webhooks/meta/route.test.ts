// @vitest-environment node

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { inboundTextFixture } from "@/test/fixtures/meta-webhooks";
import { normalizeWebhook } from "@/modules/webhooks/normalize";
import { verifyMetaSignature, verifyMetaToken } from "@/modules/webhooks/signature";

import { createMetaWebhookRouteHandlers } from "./route";

const appSecret = "app-secret-marker";
const verifyToken = "verify-token-marker";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
}

function request(body: string, signature = sign(body)): Request {
  return new Request("http://localhost/api/webhooks/meta", {
    method: "POST",
    headers: { "x-hub-signature-256": signature },
    body,
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const logs: Array<{ level: string; event: string; fields?: Record<string, unknown> }> = [];
  const base = {
    getServerEnv: () => ({
      META_APP_SECRET: appSecret,
      WHATSAPP_VERIFY_TOKEN: verifyToken,
    }),
    normalizeWebhook,
    processWebhookEvents: async () => ({ processed: 1, duplicates: 0 }),
    verifyMetaSignature,
    verifyMetaToken,
    logger: {
      info: (event: string, fields?: Record<string, unknown>) =>
        logs.push({ level: "info", event, fields }),
      warn: (event: string, fields?: Record<string, unknown>) =>
        logs.push({ level: "warn", event, fields }),
      error: (event: string, fields?: Record<string, unknown>) =>
        logs.push({ level: "error", event, fields }),
    },
    ...overrides,
  };
  return { dependencies: base, logs };
}

describe("Meta webhook route", () => {
  it("returns the challenge only for subscribe mode and the configured verify token", async () => {
    const harness = dependencies();
    const { GET } = createMetaWebhookRouteHandlers(harness.dependencies as never);

    const accepted = await GET(
      new Request(
        `http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=challenge-123`,
      ),
    );
    const rejected = await GET(
      new Request(
        "http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=secret-challenge",
      ),
    );

    expect(accepted.status).toBe(200);
    await expect(accepted.text()).resolves.toBe("challenge-123");
    expect(rejected.status).toBe(403);
    await expect(rejected.text()).resolves.not.toContain("secret-challenge");
  });

  it("reads and authenticates the exact raw body before processing", async () => {
    const body = JSON.stringify(inboundTextFixture);
    let receivedEvents: unknown[] | undefined;
    const harness = dependencies({
      processWebhookEvents: async (events: unknown[]) => {
        receivedEvents = events;
        return { processed: 1, duplicates: 0 };
      },
    });
    const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);

    const response = await POST(request(body));

    expect(response.status).toBe(200);
    expect(receivedEvents).toHaveLength(1);
    await expect(response.json()).resolves.toEqual({
      received: true,
      processed: 1,
      duplicates: 0,
    });
  });

  it.each(["", "sha256=abc", `sha256=${"0".repeat(64)}`])(
    "returns 401 for a missing, malformed or invalid signature: %s",
    async (signature) => {
      const body = JSON.stringify(inboundTextFixture);
      let processed = false;
      const harness = dependencies({
        processWebhookEvents: async () => {
          processed = true;
          return { processed: 1, duplicates: 0 };
        },
      });
      const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);

      const response = await POST(request(body, signature));

      expect(response.status).toBe(401);
      expect(processed).toBe(false);
      expect(JSON.stringify(await response.json())).not.toContain(appSecret);
      expect(JSON.stringify(harness.logs)).not.toContain(body);
    },
  );

  it("returns a safe 400 for signed invalid JSON without processing or leaking input", async () => {
    const invalidBody = `{"private":"${appSecret}"`;
    let processed = false;
    const harness = dependencies({
      processWebhookEvents: async () => {
        processed = true;
        return { processed: 1, duplicates: 0 };
      },
    });
    const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);

    const response = await POST(request(invalidBody));
    const responseBody = await response.text();

    expect(response.status).toBe(400);
    expect(processed).toBe(false);
    expect(responseBody).not.toContain(appSecret);
    expect(JSON.stringify(harness.logs)).not.toContain(appSecret);
    expect(JSON.stringify(harness.logs)).not.toContain(invalidBody);
  });

  it("returns a safe 400 when the raw request body cannot be read", async () => {
    const secretMarker = "body-read-secret-marker";
    const harness = dependencies();
    const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);
    const unreadableRequest = {
      headers: new Headers(),
      text: async () => {
        throw new Error(secretMarker);
      },
    } as unknown as Request;

    const response = await POST(unreadableRequest);

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(secretMarker);
    expect(JSON.stringify(harness.logs)).not.toContain(secretMarker);
  });

  it("returns 500 with redacted logs for retryable processing failures", async () => {
    const body = JSON.stringify(inboundTextFixture);
    const harness = dependencies({
      processWebhookEvents: async () => {
        throw new Error(`database failed with ${appSecret}`);
      },
    });
    const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);

    const response = await POST(request(body));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(appSecret);
    expect(JSON.stringify(harness.logs)).not.toContain(appSecret);
    expect(JSON.stringify(harness.logs)).not.toContain(body);
  });
});
