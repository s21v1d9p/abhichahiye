import type { Address } from "viem"
import { BLOCK_SECONDS } from "./expiry"
import { n, type Rec, s } from "./records"
import { LIFETIME, MAX_QTY } from "./schema"

// Trust comes only from the immutable $creator. Attributes such as `site`, `need` or `org` are writable by anyone.

export type Clock = { nowUnix: number; block: bigint }

// Writer and reader clocks can disagree by minutes. An hour is far too little for a pledge to squat on a need.
const CLOCK_SLACK = 3600

export function isAuthenticNeed(need: Rec, sitesByKey: Map<string, Rec>): boolean {
  const site = sitesByKey.get(s(need, "site"))
  return !!site && site.creator === need.creator
}

// Only the wallet that created the need may settle a pledge made against it. Checking the receipt's own `site`
// instead would be circular: anyone can create a site and point a receipt at it.
export function settles(receipt: Rec, pledge: Rec, need: Rec): boolean {
  return s(receipt, "pledge") === pledge.key && receipt.creator === need.creator
}

// pledgeTo only writes pledges that lapse two hours after an ETA at most 48 hours away. Pledges are permissionless
// data, so the reader holds every pledge to that rule instead of trusting the writer to have followed it.
export function isWellFormedPledge(pledge: Rec, clock: Clock): boolean {
  const qty = n(pledge, "qty")
  if (qty <= 0n || qty > BigInt(MAX_QTY)) return false
  const eta = n(pledge, "eta")
  if (eta > BigInt(clock.nowUnix + LIFETIME.pledgeMaxHorizon + CLOCK_SLACK)) return false
  const lapsesAt = BigInt(clock.nowUnix) + (pledge.expiresAt - clock.block) * BigInt(BLOCK_SECONDS)
  return lapsesAt <= eta + BigInt(LIFETIME.pledgeGrace + CLOCK_SLACK)
}

export function trustedOrgs(vouches: Rec[], authorities: Address[]): Set<Address> {
  const auth = new Set(authorities.map((a) => a.toLowerCase()))
  return new Set(vouches.filter((v) => auth.has(v.creator)).map((v) => s(v, "org") as Address))
}
