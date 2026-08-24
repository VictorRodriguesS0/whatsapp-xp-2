export type MetaHealthLabel = "NORMAL" | "ATTENTION" | "CRITICAL" | "STALE";

export type MetaOperationalField =
  | "phone_number_quality_update"
  | "account_update"
  | "account_review_update"
  | "phone_number_name_update"
  | "message_template_status_update";

export type MetaAlertCategory =
  | "PHONE_QUALITY"
  | "ACCOUNT"
  | "ACCOUNT_REVIEW"
  | "PHONE_NAME"
  | "TEMPLATE";

export type MetaAlertSeverity = "INFO" | "ATTENTION" | "CRITICAL";
export type MetaAlertSource = "WEBHOOK" | "RECONCILIATION";

export type MetaTransitionDescription = {
  category: MetaAlertCategory;
  severity: MetaAlertSeverity;
  summary: string;
  alertCode: string;
  active: boolean;
  resolvesCodes: string[];
};

export type MetaRemoteQualityRating = "GREEN" | "YELLOW" | "RED" | "NA";
export type MetaRemoteReviewStatus = "PENDING" | "APPROVED" | "REJECTED";

export type MetaHealthRemoteState = {
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: MetaRemoteQualityRating | null;
  accountReviewStatus: MetaRemoteReviewStatus | null;
  templates: Array<{
    id: string;
    name: string;
    language: string;
    status: string;
  }>;
};

export type MetaHealthSummaryDto = {
  label: MetaHealthLabel;
  unacknowledgedCount: number;
  stale: boolean;
  phone: {
    displayPhoneNumber: string | null;
    verifiedName: string | null;
    qualityRating: string | null;
  };
  account: {
    reviewStatus: string | null;
    event: string | null;
    messagingLimit: string | null;
  };
  lastSuccessfulSyncAt: string | null;
  lastSyncAttemptAt: string | null;
  lastSyncErrorCode: string | null;
};

export type MetaOperationalAlertDto = {
  id: string;
  category: MetaAlertCategory;
  severity: MetaAlertSeverity;
  source: MetaAlertSource;
  sourceField: string;
  eventCode: string;
  resourceId: string | null;
  summary: string;
  details: Record<string, string | null> | null;
  occurredAt: string;
  active: boolean;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: { id: string; name: string } | null;
};

export type MetaAlertPageDto = {
  alerts: MetaOperationalAlertDto[];
  nextCursor: { occurredAt: string; id: string } | null;
};

export type MetaSyncStatus = "SYNCED" | "FRESH" | "BUSY" | "RATE_LIMITED";

export type MetaSyncResult = {
  status: MetaSyncStatus;
  success: boolean;
};
