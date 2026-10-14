export function toE6(deg: number): bigint {
  if (!Number.isFinite(deg) || deg < 0 || deg > 180) {
    throw new RangeError(`coordinate must be within 0..180 degrees, got ${deg}`)
  }
  return BigInt(Math.round(deg * 1_000_000))
}

export function fromE6(value: bigint | number): number {
  return Number(value) / 1_000_000
}

export function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
}

export type Box = { south: number; west: number; north: number; east: number }
