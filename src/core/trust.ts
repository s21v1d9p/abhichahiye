import type { Address } from "viem"
import { type Rec, s } from "./records"

// Trust comes only from the immutable $creator; attributes such as `site` or `org` are writable by anyone.

export function isAuthenticNeed(need: Rec, sitesByKey: Map<string, Rec>): boolean {
  const site = sitesByKey.get(s(need, "site"))
  return !!site && site.creator === need.creator
}

export function isValidReceipt(receipt: Rec, sitesByKey: Map<string, Rec>): boolean {
  const site = sitesByKey.get(s(receipt, "site"))
  return !!site && site.creator === receipt.creator
}

export function trustedOrgs(vouches: Rec[], authorities: Address[]): Set<Address> {
  const auth = new Set(authorities.map((a) => a.toLowerCase()))
  return new Set(vouches.filter((v) => auth.has(v.creator)).map((v) => s(v, "org") as Address))
}
