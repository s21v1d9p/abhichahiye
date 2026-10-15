import { BLOCK_SECONDS } from "../../core/expiry"

// A snapshot pairs the chain's block with the wall-clock moment we learned it, so time left can be counted down
// smoothly between refreshes instead of jumping once per block.
export type Snap = { block: bigint; fetchedAt: number }

export function secondsUntil(expiresAt: bigint, snap: Snap, nowMs: number): number {
  const secondsAtSnapshot = Number(expiresAt - snap.block) * BLOCK_SECONDS
  return Math.max(0, Math.round(secondsAtSnapshot - (nowMs - snap.fetchedAt) / 1000))
}
