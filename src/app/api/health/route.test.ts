// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.resetModules();
});

describe("health route", () => {
  it("returns ok when the database check succeeds", async () => {
    const { createHealthHandler } = await import("./route");
    const handler = createHealthHandler(async () => undefined);

    const response = await handler();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns only an unavailable status when the database check fails", async () => {
    const { createHealthHandler } = await import("./route");
    const handler = createHealthHandler(async () => {
      throw new Error("postgresql://secret@database/internal");
    });

    const response = await handler();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });

  it("returns unavailable when server configuration is missing", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.AUTH_SECRET;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete (globalThis as { prisma?: unknown }).prisma;
    vi.resetModules();

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
