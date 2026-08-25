import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import postcss, { type AtRule, type Declaration, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function declarationValue(rule: Rule, property: string) {
  return rule.nodes?.find(
    (node): node is Declaration => node.type === "decl" && node.prop === property,
  )?.value;
}

function relativeLuminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
  const [red, green, blue] = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
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

describe("settings responsive stylesheet", () => {
  it("stacks settings actions below 390px", () => {
    const root = postcss.parse(stylesheet);
    const narrowMedia = root.nodes?.find(
      (node): node is AtRule => node.type === "atrule"
        && node.name === "media"
        && node.params === "(max-width: 389px)",
    );
    const actions = narrowMedia?.nodes?.find(
      (node): node is Rule => node.type === "rule" && node.selector === ".settings-page-actions",
    );

    expect(actions).toBeDefined();
    if (!actions) return;
    expect(declarationValue(actions, "flex-direction")).toBe("column");
    expect(declarationValue(actions, "align-items")).toBe("stretch");
  });
});

describe("public login responsive stylesheet", () => {
  it("keeps the light-theme accent readable on every new public and status surface", () => {
    const root = postcss.parse(stylesheet);
    const lightTheme = root.nodes?.find(
      (node): node is Rule => node.type === "rule" && node.selector.includes(':root[data-theme="light"]'),
    );

    expect(lightTheme).toBeDefined();
    if (!lightTheme) return;
    const accent = declarationValue(lightTheme, "--accent") ?? "";
    for (const surfaceToken of ["--panel", "--surface", "--selected"]) {
      const surface = declarationValue(lightTheme, surfaceToken) ?? "";
      expect(contrastRatio(accent, surface), `${accent} on ${surfaceToken}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("switches the compact login card to two areas at 900px", () => {
    const root = postcss.parse(stylesheet);
    const desktopMedia = root.nodes?.find(
      (node): node is AtRule => node.type === "atrule"
        && node.name === "media"
        && node.params === "(min-width: 900px)",
    );
    const layout = desktopMedia?.nodes?.find(
      (node): node is Rule => node.type === "rule" && node.selector === ".login-layout",
    );

    expect(layout).toBeDefined();
    if (!layout) return;
    expect(declarationValue(layout, "grid-template-columns")).toBe("minmax(0, 1.15fr) minmax(22rem, 0.85fr)");
  });
});

describe("semantic button contrast", () => {
  it.each([
    ["light", ':root[data-theme="light"]'],
    ["dark", ':root[data-theme="dark"]'],
  ])("keeps actual foreground text readable over normal and hover backgrounds in the %s theme", (_theme, selector) => {
    const root = postcss.parse(stylesheet);
    const theme = root.nodes?.find(
      (node): node is Rule => node.type === "rule" && node.selector.includes(selector),
    );

    expect(theme).toBeDefined();
    if (!theme) return;
    for (const variant of ["primary", "destructive"]) {
      const foregroundToken = `--${variant}-foreground`;
      const foreground = declarationValue(theme, foregroundToken) ?? "";
      expect(foreground, `${foregroundToken} must be an explicit color`).toMatch(/^#[0-9a-f]{6}$/i);

      for (const backgroundToken of [`--${variant}`, `--${variant}-hover`]) {
        const background = declarationValue(theme, backgroundToken) ?? "";
        expect(background, `${backgroundToken} must be an explicit color`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(
          contrastRatio(foreground, background),
          `${foregroundToken} text over ${backgroundToken} background`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("semantic message and attention contrast", () => {
  it.each([
    ["light", ':root[data-theme="light"]'],
    ["dark", ':root[data-theme="dark"]'],
  ])("keeps accent, muted and attention copy at 4.5:1 on their real %s surfaces", (_theme, selector) => {
    const root = postcss.parse(stylesheet);
    const theme = root.nodes?.find(
      (node): node is Rule => node.type === "rule" && node.selector.includes(selector),
    );

    expect(theme).toBeDefined();
    if (!theme) return;

    const pairs = [
      ["--accent", "--inbound"],
      ["--accent", "--outbound"],
      ["--accent", "--quoted-surface"],
      ["--accent", "--rich-surface"],
      ["--muted", "--inbound"],
      ["--muted", "--outbound"],
      ["--muted", "--quoted-surface"],
      ["--muted", "--rich-surface"],
      ["--attention-text", "--warning"],
    ] as const;

    for (const [foregroundToken, backgroundToken] of pairs) {
      const foreground = declarationValue(theme, foregroundToken) ?? "";
      const background = declarationValue(theme, backgroundToken) ?? "";
      expect(foreground, foregroundToken).toMatch(/^#[0-9a-f]{6}$/i);
      expect(background, backgroundToken).toMatch(/^#[0-9a-f]{6}$/i);
      expect(
        contrastRatio(foreground, background),
        `${foregroundToken} over ${backgroundToken}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses theme-owned quoted, rich and attention tokens without white or amber utility mixes", () => {
    const quoted = source("src/components/inbox/quoted-reply-preview.tsx");
    const rich = source("src/components/inbox/message-rich-content.tsx");
    const meta = source("src/components/meta-health/meta-health-screen.tsx");

    expect(quoted).toContain("var(--quoted-surface)");
    expect(quoted).toContain("var(--quoted-border)");
    expect(quoted).not.toMatch(/color-mix\([^)]*white/i);
    expect(rich).toContain("var(--rich-surface)");
    expect(rich).toContain("var(--rich-border)");
    expect(rich).not.toMatch(/bg-white|white\//i);
    expect(meta).toContain("var(--attention-text)");
    expect(meta).toContain("var(--attention-border)");
    expect(meta).not.toMatch(/text-amber|border-amber/i);
  });
});

describe("mobile visual viewport contract", () => {
  it("requests content resize and applies a mobile-only frame height without a 34rem floor", () => {
    const layout = source("src/app/layout.tsx");
    const shell = source("src/components/inbox/inbox-shell.tsx");

    expect(layout).toContain('interactiveWidget: "resizes-content"');
    expect(shell).toContain("useMobileVisualViewportHeight(isMobile)");
    expect(shell).toContain("mobileViewportHeight");
    expect(shell).not.toContain("min-h-[34rem]");
  });
});
