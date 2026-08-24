import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import postcss, { type AtRule, type Declaration, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function declarationValue(rule: Rule, property: string) {
  return rule.nodes?.find(
    (node): node is Declaration => node.type === "decl" && node.prop === property,
  )?.value;
}

describe("inbox responsive stylesheet", () => {
  it("keeps the customer-details trigger available in the 320–767px mobile composition", () => {
    const root = postcss.parse(stylesheet);
    const mobileMedia = root.nodes?.find(
      (node): node is AtRule => node.type === "atrule"
        && node.name === "media"
        && node.params === "(max-width: 767px)"
        && Boolean(node.nodes?.some((child) => child.type === "rule" && child.selector.includes(".customer-pane"))),
    );
    const detailsTrigger = mobileMedia?.nodes?.find(
      (node): node is Rule => node.type === "rule" && node.selector.split(",").map((selector) => selector.trim()).includes(".details-trigger"),
    );

    expect(mobileMedia).toBeDefined();
    expect(detailsTrigger).toBeDefined();
    if (!detailsTrigger) return;
    expect(declarationValue(detailsTrigger, "display")).toBe("inline-flex");
  });
});
