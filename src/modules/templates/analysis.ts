import "server-only";

import { createHash } from "node:crypto";

import type {
  ProviderTemplate,
  ProviderTemplateComponent,
} from "@/modules/whatsapp/provider";

export type AnalyzedProviderTemplate = Omit<
  ProviderTemplate,
  "components"
> & {
  components: ProviderTemplateComponent[];
  bodyText: string;
  parameterCount: number;
  supported: boolean;
  definitionHash: string;
};

function normalizedOptional(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function normalizeComponent(
  component: ProviderTemplateComponent,
): ProviderTemplateComponent {
  return {
    type: component.type.trim().toUpperCase(),
    format: normalizedOptional(component.format)?.toUpperCase() ?? null,
    text: normalizedOptional(component.text),
  };
}

function placeholderAnalysis(text: string): {
  count: number;
  valid: boolean;
} {
  const matches = [...text.matchAll(/\{\{(\d+)\}\}/gu)];
  const indexes = matches.map((match) => Number(match[1]));
  const unique = [...new Set(indexes)].sort((left, right) => left - right);
  const withoutKnownPlaceholders = text.replace(/\{\{\d+\}\}/gu, "");
  const contiguous = unique.every((value, index) => value === index + 1);
  return {
    count: unique.length,
    valid:
      !withoutKnownPlaceholders.includes("{{") &&
      !withoutKnownPlaceholders.includes("}}") &&
      matches.length === unique.length &&
      contiguous,
  };
}

export function analyzeProviderTemplate(
  template: ProviderTemplate,
): AnalyzedProviderTemplate {
  const components = template.components.map(normalizeComponent);
  const bodies = components.filter(({ type }) => type === "BODY");
  const footers = components.filter(({ type }) => type === "FOOTER");
  const onlyBodyAndFooter = components.every(
    ({ type }) => type === "BODY" || type === "FOOTER",
  );
  const bodyText = bodies[0]?.text ?? "";
  const placeholders = placeholderAnalysis(bodyText);
  const footerIsStatic = footers.every(({ text }) => {
    if (!text) return false;
    const analysis = placeholderAnalysis(text);
    return analysis.valid && analysis.count === 0;
  });
  const supported =
    onlyBodyAndFooter &&
    bodies.length === 1 &&
    footers.length <= 1 &&
    bodyText.length >= 1 &&
    bodyText.length <= 1_024 &&
    (bodies[0]?.format === null || bodies[0]?.format === "TEXT") &&
    footers.every(
      ({ format }) => format === null || format === "TEXT",
    ) &&
    footerIsStatic &&
    placeholders.valid &&
    placeholders.count === 1;
  const name = template.name.trim();
  const language = template.language.trim();
  const category = template.category.trim().toUpperCase();
  const status = template.status.trim().toUpperCase();
  const qualityScore = normalizedOptional(template.qualityScore)?.toUpperCase() ?? null;
  const definitionHash = createHash("sha256")
    .update(
      JSON.stringify({ name, language, category, status, components }),
      "utf8",
    )
    .digest("hex");

  return {
    metaId: template.metaId.trim(),
    name,
    language,
    category,
    status,
    qualityScore,
    components,
    bodyText,
    parameterCount: placeholders.count,
    supported,
    definitionHash,
  };
}

export function renderServiceResumption(
  bodyText: string,
  resolvedName: string | null,
): string {
  const parameter = resolvedName?.trim().slice(0, 80) || "cliente";
  return bodyText.replaceAll("{{1}}", parameter);
}
