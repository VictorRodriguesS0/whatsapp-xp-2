// @vitest-environment node

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { inboundTextFixture } from "@/test/fixtures/meta-webhooks";
import { normalizeWebhook } from "@/modules/webhooks/normalize";
import { WebhookProcessingError } from "@/modules/webhooks/process";
import { verifyMetaSignature, verifyMetaToken } from "@/modules/webhooks/signature";

import { createMetaWebhookRouteHandlers } from "./route";

const appSecret = "app-secret-marker";
const verifyToken = "verify-token-marker";

function sign(body: string | Uint8Array): string {
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
    maxBodyBytes: 1024 * 1024,
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

  it("accepts a body whose byte length is exactly the configured limit", async () => {
    const body = JSON.stringify(inboundTextFixture);
    const byteLength = new TextEncoder().encode(body).byteLength;
    const harness = dependencies({ maxBodyBytes: byteLength });
    const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);

    const response = await POST(
      new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        headers: {
          "content-length": String(byteLength),
          "x-hub-signature-256": sign(body),
        },
        body,
      }),
    );

    expect(response.status).toBe(200);
  });

  it.each(["-1", "1.5", "1e3", "9007199254740993"])(
    "rejects invalid Content-Length before opening the body reader: %s",
    async (contentLength) => {
      let readerWasOpened = false;
      const harness = dependencies({ maxBodyBytes: 64 });
      const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);
      const malformedRequest = {
        headers: new Headers({ "content-length": contentLength }),
        body: {
          getReader: () => {
            readerWasOpened = true;
            throw new Error("must not read");
          },
        },
      } as unknown as Request;

      const response = await POST(malformedRequest);

      expect(response.status).toBe(413);
      expect(readerWasOpened).toBe(false);
    },
  );

  it("rejects an oversized Content-Length before opening the body reader", async () => {
    let readerWasOpened = false;
    const harness = dependencies({ maxBodyBytes: 64 });
    const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);
    const oversizedRequest = {
      headers: new Headers({ "content-length": "65" }),
      body: {
        getReader: () => {
          readerWasOpened = true;
          throw new Error("must not read");
        },
      },
    } as unknown as Request;

    const response = await POST(oversizedRequest);

    expect(response.status).toBe(413);
    expect(readerWasOpened).toBe(false);
  });

  it("authenticates exact UTF-8 bytes received in chunks without Content-Length", async () => {
    const payload = structuredClone(inboundTextFixture) as Record<string, any>;
    payload.entry[0].changes[0].value.messages[0].text.body = "Olá!";
    const rawBody = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(rawBody);
    const splitAt = bytes.indexOf(0xc3) + 1;
    const chunks = [bytes.slice(0, splitAt), bytes.slice(splitAt)];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const harness = dependencies({ maxBodyBytes: bytes.byteLength });
    const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);
    const chunkedRequest = {
      headers: new Headers({ "x-hub-signature-256": sign(bytes) }),
      body: stream,
    } as unknown as Request;

    const response = await POST(chunkedRequest);

    expect(response.status).toBe(200);
  });

  it("cancels a chunked body reader as soon as the real byte limit is exceeded", async () => {
    let cancelled = false;
    const chunks = [new Uint8Array(8), new Uint8Array(1)];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const harness = dependencies({ maxBodyBytes: 8 });
    const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);
    const chunkedRequest = {
      headers: new Headers({ "x-hub-signature-256": sign(new Uint8Array(9)) }),
      body: stream,
    } as unknown as Request;

    const response = await POST(chunkedRequest);

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
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

  it("returns a safe 400 for signed bytes that are not valid UTF-8", async () => {
    const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
    const harness = dependencies();
    const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);
    const invalidRequest = new Request("http://localhost/api/webhooks/meta", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(invalidUtf8) },
      body: invalidUtf8,
    });

    const response = await POST(invalidRequest);

    expect(response.status).toBe(400);
    expect(JSON.stringify(harness.logs)).not.toContain(appSecret);
    expect(await response.text()).not.toContain(appSecret);
  });

  it("returns a safe 400 when the raw request body cannot be read", async () => {
    const secretMarker = "body-read-secret-marker";
    const harness = dependencies();
    const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error(secretMarker));
      },
    });
    const unreadableRequest = {
      headers: new Headers(),
      body: stream,
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
        throw new WebhookProcessingError(true);
      },
    });
    const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);

    const response = await POST(request(body));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(appSecret);
    expect(JSON.stringify(harness.logs)).not.toContain(appSecret);
    expect(JSON.stringify(harness.logs)).not.toContain(body);
  });

  it("returns a safe 422 for a non-retryable processing failure", async () => {
    const body = JSON.stringify(inboundTextFixture);
    const harness = dependencies({
      processWebhookEvents: async () => {
        throw new WebhookProcessingError(false);
      },
    });
    const { POST } = createMetaWebhookRouteHandlers(harness.dependencies as never);

    const response = await POST(request(body));

    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("Falha ao processar webhook");
    expect(JSON.stringify(harness.logs)).not.toContain(body);
    expect(JSON.stringify(harness.logs)).not.toContain(appSecret);
  });
});
