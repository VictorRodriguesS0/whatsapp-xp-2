type LogLevel = "info" | "warn" | "error";

type LogFields = Readonly<Record<string, unknown>>;

const REDACTED = "[REDACTED]";
const OMIT = Symbol("omit");

function shouldRedact(key: string): boolean {
  return /password|token|secret|cookie|authorization/i.test(key);
}

function shouldOmit(key: string): boolean {
  return /body|binary/i.test(key);
}

function isBinary(value: unknown): boolean {
  return (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer(value))
  );
}

function sanitize(value: unknown): unknown | typeof OMIT {
  if (value === undefined || isBinary(value)) {
    return OMIT;
  }

  if (Array.isArray(value)) {
    return value
      .map(sanitize)
      .filter((item): item is Exclude<typeof item, typeof OMIT> => item !== OMIT);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, nestedValue]) => {
        if (shouldRedact(key)) {
          return [[key, REDACTED]];
        }

        if (shouldOmit(key)) {
          return [];
        }

        const sanitized = sanitize(nestedValue);
        return sanitized === OMIT ? [] : [[key, sanitized]];
      }),
    );
  }

  return value;
}

function write(level: LogLevel, event: string, fields: LogFields = {}): void {
  const sanitized = sanitize(fields);
  const record = {
    level,
    event,
    ...(sanitized === OMIT ? {} : (sanitized as Record<string, unknown>)),
  };

  console[level](JSON.stringify(record));
}

export const logger = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
