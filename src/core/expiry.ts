import { ExpirationTime } from "@arkiv-network/sdk/utils"
import { TTL, type Urgency } from "./schema"

export const BLOCK_SECONDS = 2

export function blocksFor(seconds: number): bigint {
  return BigInt(Math.ceil(seconds / BLOCK_SECONDS))
}

export function secondsLeft(expiresAt: bigint, currentBlock: bigint): number {
  const d = expiresAt - currentBlock
  return d > 0n ? Number(d) * BLOCK_SECONDS : 0
}

// Lifetime Extension sets a new expiry and reverts unless it is strictly later than the current one.
export function renewalTarget(currentExpiresAt: bigint, currentBlock: bigint, ttlSeconds: number): bigint {
  const fromNow = currentBlock + blocksFor(ttlSeconds)
  return fromNow > currentExpiresAt ? fromNow : currentExpiresAt + 1n
}

// Skip renewing a lease that is still almost full, so quick successive writes don't add pointless extensions.
export function needsLeaseRenewal(
  currentExpiresAt: bigint,
  currentBlock: bigint,
  ttlSeconds: number,
  slackSeconds = 3600,
): boolean {
  return secondsLeft(currentExpiresAt, currentBlock) < ttlSeconds - slackSeconds
}

export const needLifetime = (u: Urgency) => ExpirationTime.fromSeconds(TTL.need[u])

export const pledgeExpiry = (etaUnix: number) =>
  ExpirationTime.atDate(new Date((etaUnix + TTL.pledgeGrace) * 1000))
