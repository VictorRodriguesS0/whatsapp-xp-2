import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "./logger";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes one JSON line and redacts secret fields", () => {
    const write = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logger.info("auth.login", {
      accessToken: "private-value",
      nested: { authorization: "Bearer private-value" },
      requestBody: "do not log this",
    });

    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]).toHaveLength(1);
    expect(JSON.parse(write.mock.calls[0][0] as string)).toEqual({
      event: "auth.login",
      level: "info",
      accessToken: "[REDACTED]",
      nested: { authorization: "[REDACTED]" },
    });
  });
});
