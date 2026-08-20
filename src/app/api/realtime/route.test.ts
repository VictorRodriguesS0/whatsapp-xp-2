// @vitest-environment node

import { describe, expect, it } from "vitest";

import { HttpError } from "@/lib/http";

import { createRealtimeRouteHandlers } from "./route";

describe("realtime route", () => {
  it("returns 401 before opening a stream when there is no active session", async () => {
    let streamWasOpened = false;
    const { GET } = createRealtimeRouteHandlers({
      requireUser: async () => {
        throw new HttpError(401, "Não autenticado");
      },
      subscribeRealtime: () => {
        streamWasOpened = true;
        return new ReadableStream();
      },
    });

    const response = await GET(new Request("http://localhost/api/realtime"));

    expect(response.status).toBe(401);
    expect(streamWasOpened).toBe(false);
    await expect(response.json()).resolves.toEqual({ error: "Não autenticado" });
  });

  it("opens an authenticated stream with SSE buffering headers", async () => {
    let receivedSignal: AbortSignal | undefined;
    let receivedUserId: string | undefined;
    let authenticationCalls = 0;
    const { GET } = createRealtimeRouteHandlers({
      requireUser: async () => {
        authenticationCalls += 1;
        return {
          id: "user-1",
          name: "Victor",
          email: "victor@example.test",
          role: "ADMIN",
        };
      },
      subscribeRealtime: (signal, userId) => {
        receivedSignal = signal;
        receivedUserId = userId;
        return new ReadableStream();
      },
    });
    const request = new Request("http://localhost/api/realtime");

    const response = await GET(request);

    expect(receivedSignal).toBe(request.signal);
    expect(receivedUserId).toBe("user-1");
    expect(authenticationCalls).toBe(1);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
  });
});
