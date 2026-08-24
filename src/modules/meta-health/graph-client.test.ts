// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createMetaHealthGraphClient,
  MetaHealthGraphError,
} from "./graph-client";

function jsonResponse(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function config(fetcher: typeof fetch) {
  return {
    graphVersion: "v23.0",
    phoneNumberId: "phone-1",
    wabaId: "waba-1",
    accessToken: "secret-token",
    timeoutMs: 100,
    fetcher,
  };
}

describe("Meta health Graph client", () => {
  it("returns bounded phone, WABA, and template state", async () => {
    const responses = [
      {
        id: "phone-1",
        display_phone_number: "+55 61 99999-0000",
        verified_name: "XP Eletrônicos",
        quality_rating: "GREEN",
        private_field: "must-not-survive",
      },
      { id: "waba-1", account_review_status: "APPROVED" },
      {
        data: [
          {
            id: "tpl-1",
            name: "aviso",
            language: "pt_BR",
            status: "APPROVED",
            components: [{ text: "private" }],
          },
        ],
      },
    ];
    const fetcher = vi.fn(async () => jsonResponse(responses.shift()));

    const client = createMetaHealthGraphClient(config(fetcher));

    await expect(client.fetchState()).resolves.toEqual({
      phoneNumberId: "phone-1",
      wabaId: "waba-1",
      displayPhoneNumber: "+55 61 99999-0000",
      verifiedName: "XP Eletrônicos",
      qualityRating: "GREEN",
      accountReviewStatus: "APPROVED",
      templates: [
        {
          id: "tpl-1",
          name: "aviso",
          language: "pt_BR",
          status: "APPROVED",
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, init] of fetcher.mock.calls as unknown as Array<
      [RequestInfo | URL, RequestInit | undefined]
    >) {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer secret-token",
      );
    }
  });

  it("follows only bounded Graph pagination", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: "phone-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "waba-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "tpl-1", name: "um", language: "pt_BR", status: "APPROVED" }],
          paging: {
            next: "https://graph.facebook.com/v23.0/waba-1/message_templates?after=next",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "tpl-2", name: "dois", language: "pt_BR", status: "REJECTED" }],
        }),
      );

    await expect(
      createMetaHealthGraphClient(config(fetcher)).fetchState(),
    ).resolves.toMatchObject({
      templates: [{ id: "tpl-1" }, { id: "tpl-2" }],
    });
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://graph.facebook.com/v23.0/waba-1/message_templates?after=next",
      expect.any(Object),
    );
  });

  it("rejects pagination away from the Graph host", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: "phone-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "waba-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [],
          paging: { next: "https://attacker.example/templates" },
        }),
      );

    await expect(
      createMetaHealthGraphClient(config(fetcher)).fetchState(),
    ).rejects.toMatchObject({ code: "META_INVALID_RESPONSE" });
  });

  it.each([
    [401, "META_UNAUTHORIZED"],
    [403, "META_UNAUTHORIZED"],
    [429, "META_RATE_LIMITED"],
    [500, "META_UNAVAILABLE"],
  ] as const)("maps HTTP %s to %s", async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { error: { message: "secret-token private marker" } },
        { status },
      ),
    );

    const promise = createMetaHealthGraphClient(config(fetcher)).fetchState();
    await expect(promise).rejects.toMatchObject({ code });
    await expect(promise).rejects.not.toThrow(/secret-token|private marker/i);
  });

  it("rejects malformed JSON without exposing it", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("private malformed marker", { status: 200 }),
    );

    const promise = createMetaHealthGraphClient(config(fetcher)).fetchState();
    await expect(promise).rejects.toMatchObject({
      code: "META_INVALID_RESPONSE",
    });
    await expect(promise).rejects.not.toThrow(/private malformed marker/i);
  });

  it("times out with a public error", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementation((_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
      );

    await expect(
      createMetaHealthGraphClient({ ...config(fetcher), timeoutMs: 5 }).fetchState(),
    ).rejects.toEqual(new MetaHealthGraphError("META_TIMEOUT"));
  });

  it("rejects oversized template collections", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: "phone-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "waba-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: Array.from({ length: 2_001 }, (_, index) => ({
            id: `tpl-${index}`,
            name: `template_${index}`,
            language: "pt_BR",
            status: "APPROVED",
          })),
        }),
      );

    await expect(
      createMetaHealthGraphClient(config(fetcher)).fetchState(),
    ).rejects.toMatchObject({ code: "META_INVALID_RESPONSE" });
  });
});
