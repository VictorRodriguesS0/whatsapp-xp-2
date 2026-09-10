import type {
  MetaAlertCategory,
  MetaHealthLabel,
  MetaOperationalField,
  MetaTransitionDescription,
} from "./types";

export const META_HEALTH_STALE_AFTER_MS = 15 * 60_000;

const criticalAlertCodes = new Set([
  "ACCOUNT_OFFBOARDED",
  "PARTNER_REMOVED",
  "CONNECTION_DISCONNECTED",
  "ACCOUNT_DISABLED",
  "ACCOUNT_BANNED",
  "QUALITY_RED",
]);

const attentionAlertCodes = new Set([
  "PHONE_FLAGGED",
  "PHONE_DOWNGRADE",
  "QUALITY_YELLOW",
  "ACCOUNT_REVIEW_PENDING",
  "ACCOUNT_REVIEW_REJECTED",
  "PHONE_NAME_REJECTED",
  "TEMPLATE_REJECTED",
  "TEMPLATE_DISABLED",
  "TEMPLATE_FLAGGED",
  "TEMPLATE_IN_APPEAL",
  "TEMPLATE_PENDING_DELETION",
]);

type LabelInput = {
  connectionState?: string;
  qualityRating: string | null;
  activeCodes: string[];
  lastSuccessfulSyncAt: Date | null;
};

export function deriveMetaHealthLabel(
  input: LabelInput,
  now = new Date(),
): MetaHealthLabel {
  if (
    input.connectionState === "DISCONNECTED" ||
    input.qualityRating === "RED" ||
    input.activeCodes.some((code) => criticalAlertCodes.has(code))
  ) {
    return "CRITICAL";
  }

  if (
    input.qualityRating === "YELLOW" ||
    input.activeCodes.some((code) => attentionAlertCodes.has(code))
  ) {
    return "ATTENTION";
  }

  const stale =
    input.lastSuccessfulSyncAt === null ||
    now.getTime() - input.lastSuccessfulSyncAt.getTime() >
      META_HEALTH_STALE_AFTER_MS;

  return stale || input.connectionState === "UNKNOWN" ? "STALE" : "NORMAL";
}

const transitionMap = new Map<string, MetaTransitionDescription>();

function transition(
  field: MetaOperationalField,
  eventCode: string,
  description: MetaTransitionDescription,
) {
  transitionMap.set(`${field}:${eventCode}`, description);
}

function info(
  category: MetaAlertCategory,
  summary: string,
  alertCode: string,
  resolvesCodes: string[] = [],
): MetaTransitionDescription {
  return {
    category,
    severity: "INFO",
    summary,
    alertCode,
    active: false,
    resolvesCodes,
  };
}

function attention(
  category: MetaAlertCategory,
  summary: string,
  alertCode: string,
): MetaTransitionDescription {
  return {
    category,
    severity: "ATTENTION",
    summary,
    alertCode,
    active: true,
    resolvesCodes: [],
  };
}

function critical(
  category: MetaAlertCategory,
  summary: string,
  alertCode: string,
): MetaTransitionDescription {
  return {
    category,
    severity: "CRITICAL",
    summary,
    alertCode,
    active: true,
    resolvesCodes: [],
  };
}

transition(
  "phone_number_quality_update",
  "FLAGGED",
  attention("PHONE_QUALITY", "Número sinalizado pela Meta", "PHONE_FLAGGED"),
);
transition(
  "phone_number_quality_update",
  "UNFLAGGED",
  info("PHONE_QUALITY", "Sinalização do número removida", "PHONE_RECOVERED", [
    "PHONE_FLAGGED",
    "PHONE_DOWNGRADE",
  ]),
);
transition(
  "phone_number_quality_update",
  "DOWNGRADE",
  attention("PHONE_QUALITY", "Qualidade do número foi reduzida", "PHONE_DOWNGRADE"),
);
transition(
  "phone_number_quality_update",
  "UPGRADE",
  info("PHONE_QUALITY", "Qualidade do número melhorou", "PHONE_UPGRADE", [
    "PHONE_DOWNGRADE",
  ]),
);
transition(
  "phone_number_quality_update",
  "ONBOARDING",
  info("PHONE_QUALITY", "Número conectado à Meta", "PHONE_ONBOARDING"),
);
transition(
  "phone_number_quality_update",
  "YELLOW",
  attention("PHONE_QUALITY", "Qualidade do número requer atenção", "QUALITY_YELLOW"),
);
transition(
  "phone_number_quality_update",
  "RED",
  critical("PHONE_QUALITY", "Qualidade do número está crítica", "QUALITY_RED"),
);
transition(
  "phone_number_quality_update",
  "GREEN",
  info("PHONE_QUALITY", "Qualidade do número está normal", "QUALITY_GREEN", [
    "QUALITY_YELLOW",
    "QUALITY_RED",
  ]),
);

transition(
  "account_update",
  "DISABLED_UPDATE",
  critical("ACCOUNT", "Conta desativada pela Meta", "ACCOUNT_DISABLED"),
);
transition(
  "account_update",
  "DISABLE",
  critical("ACCOUNT", "Conta bloqueada pela Meta", "ACCOUNT_BANNED"),
);
transition(
  "account_update",
  "REINSTATE",
  info("ACCOUNT", "Conta restabelecida pela Meta", "ACCOUNT_REINSTATED", [
    "ACCOUNT_DISABLED",
    "ACCOUNT_BANNED",
  ]),
);
transition(
  "account_update",
  "VERIFIED_ACCOUNT",
  info("ACCOUNT", "Conta verificada pela Meta", "ACCOUNT_VERIFIED", [
    "ACCOUNT_DISABLED",
  ]),
);

transition(
  "account_review_update",
  "PENDING",
  attention("ACCOUNT_REVIEW", "Revisão da conta pendente", "ACCOUNT_REVIEW_PENDING"),
);
transition(
  "account_review_update",
  "REJECTED",
  attention("ACCOUNT_REVIEW", "Revisão da conta rejeitada", "ACCOUNT_REVIEW_REJECTED"),
);
transition(
  "account_review_update",
  "APPROVED",
  info("ACCOUNT_REVIEW", "Revisão da conta aprovada", "ACCOUNT_REVIEW_APPROVED", [
    "ACCOUNT_REVIEW_PENDING",
    "ACCOUNT_REVIEW_REJECTED",
  ]),
);

transition(
  "phone_number_name_update",
  "REJECTED",
  attention("PHONE_NAME", "Nome comercial rejeitado", "PHONE_NAME_REJECTED"),
);
transition(
  "phone_number_name_update",
  "APPROVED",
  info("PHONE_NAME", "Nome comercial aprovado", "PHONE_NAME_APPROVED", [
    "PHONE_NAME_REJECTED",
  ]),
);

for (const [eventCode, summary, alertCode] of [
  ["REJECTED", "Template rejeitado pela Meta", "TEMPLATE_REJECTED"],
  ["DISABLED", "Template desativado pela Meta", "TEMPLATE_DISABLED"],
  ["FLAGGED", "Template sinalizado pela Meta", "TEMPLATE_FLAGGED"],
  ["IN_APPEAL", "Template está em análise de recurso", "TEMPLATE_IN_APPEAL"],
  [
    "PENDING_DELETION",
    "Template está pendente de exclusão",
    "TEMPLATE_PENDING_DELETION",
  ],
] as const) {
  transition(
    "message_template_status_update",
    eventCode,
    attention("TEMPLATE", summary, alertCode),
  );
}

for (const [eventCode, summary] of [
  ["APPROVED", "Template aprovado pela Meta"],
  ["REINSTATED", "Template restabelecido pela Meta"],
] as const) {
  transition(
    "message_template_status_update",
    eventCode,
    info("TEMPLATE", summary, `TEMPLATE_${eventCode}`, [
      "TEMPLATE_REJECTED",
      "TEMPLATE_DISABLED",
      "TEMPLATE_FLAGGED",
    ]),
  );
}

transition(
  "message_template_status_update",
  "PENDING",
  info("TEMPLATE", "Template enviado para análise", "TEMPLATE_PENDING"),
);
transition(
  "message_template_status_update",
  "DELETED",
  info("TEMPLATE", "Template excluído na Meta", "TEMPLATE_DELETED", [
    "TEMPLATE_PENDING_DELETION",
  ]),
);

for (const [eventCode, summary] of [
  ["ACCOUNT_OFFBOARDED", "Integração desconectada do WhatsApp Business"],
  ["PARTNER_REMOVED", "Plataforma comercial desconectada"],
  ["CONNECTION_DISCONNECTED", "A Meta confirmou que a integração está desconectada"],
] as const) {
  transition("account_update", eventCode, critical("ACCOUNT", summary, eventCode));
}
transition("account_update", "ACCOUNT_RECONNECTED", info("ACCOUNT", "Reconexão informada pela Meta; aguardando confirmação", "ACCOUNT_RECONNECTED"));
transition("account_update", "CONNECTION_CONNECTED", info("ACCOUNT", "Conexão com a plataforma confirmada", "CONNECTION_CONNECTED", ["ACCOUNT_OFFBOARDED", "PARTNER_REMOVED", "CONNECTION_DISCONNECTED"]));

const fallbackByField: Record<
  MetaOperationalField,
  Pick<MetaTransitionDescription, "category" | "summary" | "alertCode">
> = {
  phone_number_quality_update: {
    category: "PHONE_QUALITY",
    summary: "Atualização de qualidade recebida",
    alertCode: "PHONE_QUALITY_UPDATE",
  },
  account_update: {
    category: "ACCOUNT",
    summary: "Atualização da conta recebida",
    alertCode: "ACCOUNT_UPDATE",
  },
  account_review_update: {
    category: "ACCOUNT_REVIEW",
    summary: "Atualização da revisão recebida",
    alertCode: "ACCOUNT_REVIEW_UPDATE",
  },
  phone_number_name_update: {
    category: "PHONE_NAME",
    summary: "Atualização do nome comercial recebida",
    alertCode: "PHONE_NAME_UPDATE",
  },
  message_template_status_update: {
    category: "TEMPLATE",
    summary: "Atualização de template recebida",
    alertCode: "TEMPLATE_UPDATE",
  },
};

export function describeMetaTransition(
  field: MetaOperationalField,
  eventCode: string,
): MetaTransitionDescription {
  const exact = transitionMap.get(`${field}:${eventCode}`);
  if (exact) return { ...exact, resolvesCodes: [...exact.resolvesCodes] };

  const fallback = fallbackByField[field];
  return {
    ...fallback,
    severity: "INFO",
    active: false,
    resolvesCodes: [],
  };
}
