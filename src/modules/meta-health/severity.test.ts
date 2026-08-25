import { describe, expect, it } from "vitest";

import { deriveMetaHealthLabel, describeMetaTransition } from "./severity";

describe("Meta health severity", () => {
  it.each([
    ["GREEN", [], "NORMAL"],
    ["YELLOW", [], "ATTENTION"],
    ["RED", [], "CRITICAL"],
    ["GREEN", ["ACCOUNT_DISABLED"], "CRITICAL"],
    ["GREEN", ["TEMPLATE_REJECTED"], "ATTENTION"],
  ] as const)(
    "maps %s and %j to %s",
    (qualityRating, activeCodes, expected) => {
      expect(
        deriveMetaHealthLabel(
          {
            qualityRating,
            activeCodes: [...activeCodes],
            lastSuccessfulSyncAt: new Date("2026-08-23T12:00:00Z"),
          },
          new Date("2026-08-23T12:10:00Z"),
        ),
      ).toBe(expected);
    },
  );

  it("never hides a known critical state behind stale", () => {
    expect(
      deriveMetaHealthLabel(
        {
          qualityRating: "RED",
          activeCodes: [],
          lastSuccessfulSyncAt: new Date("2026-08-23T10:00:00Z"),
        },
        new Date("2026-08-23T12:00:00Z"),
      ),
    ).toBe("CRITICAL");
  });

  it("keeps a known warning visible when the snapshot is stale", () => {
    expect(
      deriveMetaHealthLabel(
        {
          qualityRating: "GREEN",
          activeCodes: ["PHONE_FLAGGED"],
          lastSuccessfulSyncAt: new Date("2026-08-23T10:00:00Z"),
        },
        new Date("2026-08-23T12:00:00Z"),
      ),
    ).toBe("ATTENTION");
  });

  it("returns stale when freshness is unknown and no stronger state exists", () => {
    expect(
      deriveMetaHealthLabel(
        {
          qualityRating: null,
          activeCodes: [],
          lastSuccessfulSyncAt: null,
        },
        new Date("2026-08-23T12:00:00Z"),
      ),
    ).toBe("STALE");
  });

  it("becomes stale strictly after fifteen minutes", () => {
    const input = {
      qualityRating: "GREEN" as const,
      activeCodes: [],
      lastSuccessfulSyncAt: new Date("2026-08-23T12:00:00Z"),
    };

    expect(
      deriveMetaHealthLabel(input, new Date("2026-08-23T12:15:00Z")),
    ).toBe("NORMAL");
    expect(
      deriveMetaHealthLabel(input, new Date("2026-08-23T12:15:00.001Z")),
    ).toBe("STALE");
  });

  it("uses safe Portuguese copy for documented events", () => {
    expect(
      describeMetaTransition("phone_number_quality_update", "FLAGGED"),
    ).toMatchObject({
      category: "PHONE_QUALITY",
      severity: "ATTENTION",
      summary: "Número sinalizado pela Meta",
      alertCode: "PHONE_FLAGGED",
      resolvesCodes: [],
    });
    expect(
      describeMetaTransition("account_update", "DISABLED_UPDATE"),
    ).toMatchObject({
      category: "ACCOUNT",
      severity: "CRITICAL",
      summary: "Conta desativada pela Meta",
      alertCode: "ACCOUNT_DISABLED",
    });
  });

  it("classifies reconciled phone quality transitions", () => {
    expect(describeMetaTransition("phone_number_quality_update", "RED")).toMatchObject({
      severity: "CRITICAL",
      alertCode: "QUALITY_RED",
      active: true,
    });
    expect(describeMetaTransition("phone_number_quality_update", "GREEN")).toMatchObject({
      severity: "INFO",
      alertCode: "QUALITY_GREEN",
      active: false,
      resolvesCodes: ["QUALITY_YELLOW", "QUALITY_RED"],
    });
  });

  it("marks positive transitions as informational resolutions", () => {
    expect(
      describeMetaTransition("phone_number_quality_update", "UNFLAGGED"),
    ).toMatchObject({
      severity: "INFO",
      active: false,
      resolvesCodes: ["PHONE_FLAGGED", "PHONE_DOWNGRADE"],
    });
    expect(
      describeMetaTransition("message_template_status_update", "APPROVED"),
    ).toMatchObject({
      severity: "INFO",
      active: false,
      resolvesCodes: [
        "TEMPLATE_REJECTED",
        "TEMPLATE_DISABLED",
        "TEMPLATE_FLAGGED",
      ],
    });
    expect(
      describeMetaTransition("message_template_status_update", "DELETED"),
    ).toMatchObject({
      severity: "INFO",
      active: false,
      alertCode: "TEMPLATE_DELETED",
      resolvesCodes: ["TEMPLATE_PENDING_DELETION"],
    });
  });

  it("does not interpolate unknown provider content", () => {
    expect(
      describeMetaTransition(
        "message_template_status_update",
        "PRIVATE_PROVIDER_MARKER",
      ),
    ).toEqual({
      category: "TEMPLATE",
      severity: "INFO",
      summary: "Atualização de template recebida",
      alertCode: "TEMPLATE_UPDATE",
      active: false,
      resolvesCodes: [],
    });
  });
});
