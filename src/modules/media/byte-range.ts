export type ByteRange = {
  start: bigint;
  end: bigint;
  length: bigint;
};

export class UnsatisfiableByteRangeError extends Error {
  constructor() {
    super("Intervalo de bytes inválido");
    this.name = "UnsatisfiableByteRangeError";
  }
}

function invalidRange(): never {
  throw new UnsatisfiableByteRangeError();
}

function decimal(value: string): bigint {
  if (!/^\d+$/u.test(value)) invalidRange();
  try {
    return BigInt(value);
  } catch {
    return invalidRange();
  }
}

export function parseSingleByteRange(
  value: string | null,
  size: bigint,
): ByteRange | null {
  if (value === null) return null;
  if (size <= 0n || !/^bytes=/iu.test(value) || value.includes(",")) invalidRange();

  const specification = value.slice(value.indexOf("=") + 1);
  const match = /^(\d*)-(\d*)$/u.exec(specification);
  if (!match || (!match[1] && !match[2])) invalidRange();

  let start: bigint;
  let end: bigint;
  if (!match[1]) {
    const suffixLength = decimal(match[2]!);
    if (suffixLength === 0n) invalidRange();
    start = suffixLength >= size ? 0n : size - suffixLength;
    end = size - 1n;
  } else {
    start = decimal(match[1]);
    if (start >= size) invalidRange();
    end = match[2] ? decimal(match[2]) : size - 1n;
    if (end < start) invalidRange();
    if (end >= size) end = size - 1n;
  }

  return { start, end, length: end - start + 1n };
}
