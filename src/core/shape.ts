import { type Rec, s } from "./records"
import { APP, ITEMS, type Kind, MAX_QTY, ORG_TYPES, SITE_TYPES } from "./schema"

// Arkiv is permissionless, so a reader must not assume an entity has the shape our writers give it. Every entity is
// checked here before any view uses it, against the same rules our own writers enforce (attrs.ts, geo.ts): known
// types and items, quantities from 1 to MAX_QTY, urgency 1 to 3, coordinates within 0 to 180 degrees. Anything else
// was not written by AbhiChahiye, whatever its kind says, and is skipped as if it had never been written. A number
// out of range is not harmless: a u256 longitude of 10^30 sends the map library into an endless loop.

const HEX32 = /^0x[0-9a-f]{64}$/
const ADDRESS = /^0x[0-9a-f]{40}$/
const MAX_E6 = 180_000_000n
const MAX_U64 = 2n ** 64n - 1n

const oneOf = (values: readonly string[]) => {
  const allowed = new Set(values)
  return (r: Rec, name: string) => allowed.has(s(r, name))
}
const isItem = oneOf(ITEMS)
const isOrgType = oneOf(ORG_TYPES)
const isSiteType = oneOf(SITE_TYPES)

const within = (r: Rec, name: string, min: bigint, max: bigint) => {
  const v = r.attrs[name]
  return typeof v === "bigint" && v >= min && v <= max
}
const quantity = (r: Rec, name: string) => within(r, name, 1n, BigInt(MAX_QTY))
const located = (r: Rec) => within(r, "lat_e6", 0n, MAX_E6) && within(r, "lng_e6", 0n, MAX_E6)
const keyAt = (r: Rec, name: string) => HEX32.test(s(r, name))

const RULES: Record<Kind, (r: Rec) => boolean> = {
  org: (r) => isOrgType(r, "org_type"),
  site: (r) => isSiteType(r, "site_type") && located(r) && quantity(r, "people"),
  need: (r) => keyAt(r, "site") && isItem(r, "item") && quantity(r, "qty") && within(r, "urgency", 1n, 3n) && located(r),
  pledge: (r) => keyAt(r, "need") && keyAt(r, "site") && isItem(r, "item") && quantity(r, "qty") && within(r, "eta", 1n, MAX_U64),
  receipt: (r) => keyAt(r, "pledge") && keyAt(r, "need") && quantity(r, "qty"),
  vouch: (r) => ADDRESS.test(s(r, "org")),
}

export function isWellFormed(r: Rec): boolean {
  if (s(r, "app") !== APP) return false
  const kind = s(r, "kind")
  return Object.hasOwn(RULES, kind) && RULES[kind as Kind](r)
}
