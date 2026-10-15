import { addr, key, str, u64 } from "@arkiv-network/sdk/attr"
import type { Address, Hex } from "viem"
import { slug, toE6 } from "./geo"
import { APP, type Item, KIND, MAX_QTY, type OrgType, type SiteType, type Urgency } from "./schema"

const base = (kind: string) => ({ app: str(APP), kind: str(kind) })

function positive(value: number, what: string): bigint {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${what} must be a positive integer, got ${value}`)
  }
  return BigInt(value)
}

// Counts of people and goods are capped so that no entity, written by us or anyone else, can carry an absurd number.
function quantity(value: number, what: string): bigint {
  const parsed = positive(value, what)
  if (parsed > BigInt(MAX_QTY)) throw new RangeError(`${what} must be at most ${MAX_QTY}, got ${value}`)
  return parsed
}

function urgencyOf(u: number): bigint {
  if (u !== 1 && u !== 2 && u !== 3) throw new RangeError(`urgency must be 1, 2 or 3, got ${u}`)
  return BigInt(u)
}

const PHONE = /(?:\+?91[\s-]*)?[6-9](?:[\s-]*\d){9}/

export function assertNoPhone(text: string): void {
  if (PHONE.test(text)) {
    throw new Error("Remove phone numbers: personal data must not be written to Arkiv")
  }
}

export function orgAttrs(o: { orgType: OrgType; state: string; district: string }) {
  return {
    ...base(KIND.org),
    org_type: str(o.orgType),
    state: str(o.state.toLowerCase()),
    district: str(slug(o.district)),
  }
}

export function siteAttrs(x: {
  siteType: SiteType
  state: string
  district: string
  lat: number
  lng: number
  people: number
}) {
  return {
    ...base(KIND.site),
    site_type: str(x.siteType),
    state: str(x.state.toLowerCase()),
    district: str(slug(x.district)),
    lat_e6: u64(toE6(x.lat)),
    lng_e6: u64(toE6(x.lng)),
    people: u64(quantity(x.people, "people")),
  }
}

export function needAttrs(x: {
  site: Hex
  state: string
  district: string
  item: Item
  qty: number
  urgency: Urgency
  lat: number
  lng: number
}) {
  return {
    ...base(KIND.need),
    site: key(x.site),
    state: str(x.state.toLowerCase()),
    district: str(slug(x.district)),
    item: str(x.item),
    qty: u64(quantity(x.qty, "qty")),
    urgency: u64(urgencyOf(x.urgency)),
    lat_e6: u64(toE6(x.lat)),
    lng_e6: u64(toE6(x.lng)),
  }
}

export function pledgeAttrs(x: { need: Hex; site: Hex; district: string; item: Item; qty: number; eta: number }) {
  return {
    ...base(KIND.pledge),
    need: key(x.need),
    site: key(x.site),
    district: str(slug(x.district)),
    item: str(x.item),
    qty: u64(quantity(x.qty, "qty")),
    eta: u64(positive(x.eta, "eta")),
  }
}

export function receiptAttrs(x: {
  pledge: Hex
  need: Hex
  site: Hex
  district: string
  qty: number
  pledger: Address
}) {
  return {
    ...base(KIND.receipt),
    pledge: key(x.pledge),
    need: key(x.need),
    site: key(x.site),
    district: str(slug(x.district)),
    qty: u64(quantity(x.qty, "qty")),
    pledger: addr(x.pledger),
  }
}

export function vouchAttrs(x: { org: Address; district: string }) {
  return { ...base(KIND.vouch), org: addr(x.org), district: str(slug(x.district)) }
}
