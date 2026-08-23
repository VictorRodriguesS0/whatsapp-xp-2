type ContactNameSource = {
  preferredName?: string | null;
  whatsappAppName?: string | null;
  profileName?: string | null;
  phone?: string | null;
};

export function formatContactPhone(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";

  if (!/^\+?[\d\s().-]+$/.test(trimmed)) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, "");

  if (/^55\d{2}\d{9}$/.test(digits)) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }

  if (/^55\d{2}\d{8}$/.test(digits)) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }

  return trimmed;
}

export function resolveContactName({
  preferredName,
  whatsappAppName,
  profileName,
  phone,
}: ContactNameSource): string {
  return preferredName?.trim() || whatsappAppName?.trim() || profileName?.trim() || formatContactPhone(phone);
}

export function contactInitials(name: string | null | undefined): string {
  const words = name?.match(/[\p{L}\p{N}]+/gu) ?? [];

  if (words.length === 0) {
    return "?";
  }

  const initials =
    words.length === 1
      ? Array.from(words[0]!).slice(0, 2).join("")
      : `${Array.from(words[0]!)[0]}${Array.from(words.at(-1)!)[0]}`;

  return initials.toLocaleUpperCase("pt-BR");
}
