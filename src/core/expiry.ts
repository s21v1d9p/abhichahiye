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

// Lifetime Extension must never shorten an entity's life, so renewals always ask for a strictly later block.
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

// A pledge hides its gap until delivery, so an unbounded ETA would let one wallet bury every need.
export function assertPledgeEta(etaUnix: number, nowUnix: number): void {
  if (!Number.isInteger(etaUnix) || etaUnix <= nowUnix) {
    throw new RangeError("ETA must be a whole unix time in the future")
  }
  if (etaUnix > nowUnix + LIFETIME.pledgeMaxHorizon) {
    throw new RangeError("ETA must be within 48 hours: a pledge hides the gap until it is delivered")
  }
}
