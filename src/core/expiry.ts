import { ExpirationTime } from "@arkiv-network/sdk/utils"
import { LIFETIME, type Urgency } from "./schema"

export const BLOCK_SECONDS = 2

export function blocksFor(seconds: number): bigint {
  return BigInt(Math.ceil(seconds / BLOCK_SECONDS))
}

export function secondsLeft(expiresAt: bigint, currentBlock: bigint): number {
  const d = expiresAt - currentBlock
  return d > 0n ? Number(d) * BLOCK_SECONDS : 0
}

// Lifetime Extension sets a new expiry and reverts unless it is strictly later than the current one.
export function renewalTarget(currentExpiresAt: bigint, currentBlock: bigint, lifetimeSeconds: number): bigint {
  const fromNow = currentBlock + blocksFor(lifetimeSeconds)
  return fromNow > currentExpiresAt ? fromNow : currentExpiresAt + 1n
}

// Skip renewing a lease that is still almost full, so quick successive writes don't add pointless extensions.
export function needsLeaseRenewal(
  currentExpiresAt: bigint,
  currentBlock: bigint,
  lifetimeSeconds: number,
  slackSeconds = 3600,
): boolean {
  return secondsLeft(currentExpiresAt, currentBlock) < lifetimeSeconds - slackSeconds
}

export const needLifetime = (u: Urgency) => ExpirationTime.fromSeconds(LIFETIME.need[u])

export const pledgeExpiry = (etaUnix: number) =>
  ExpirationTime.atDate(new Date((etaUnix + LIFETIME.pledgeGrace) * 1000))
