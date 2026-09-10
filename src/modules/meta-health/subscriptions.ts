const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const requiredFields = ["messages", "account_update", "smb_message_echoes", "smb_app_state_sync"];

/** null means malformed evidence, not an absent subscription. */
export function appSubscribedToWaba(payload: Record<string, unknown>, appId: string): boolean | null {
  if (!Array.isArray(payload.data)) return null;
  return payload.data.some((entry) => record(entry) && record(entry.whatsapp_business_api_data) && entry.whatsapp_business_api_data.id === appId);
}

export function hasCoexistenceWebhookFields(payload: Record<string, unknown>): boolean | null {
  if (!Array.isArray(payload.data)) return null;
  return payload.data.some((entry) => {
    if (!record(entry) || entry.object !== "whatsapp_business_account" || entry.active !== true || !Array.isArray(entry.fields)) return false;
    const fields = entry.fields;
    return requiredFields.every((field) => fields.some((value) => record(value) && value.name === field));
  });
}
