import { type Rec, s } from "./records"
import { APP, ITEMS, type Kind } from "./schema"

// Arkiv is permissionless, so a reader must not assume an entity has the shape our writers give it. Every entity is
// checked here before any view uses it; anything malformed is skipped, as if it had never been written.

const HEX32 = /^0x[0-9a-f]{64}$/
const ADDRESS = /^0x[0-9a-f]{40}$/
const ITEM_SET = new Set<string>(ITEMS)

const u64 = (r: Rec, name: string) => typeof r.attrs[name] === "bigint"
const keyAt = (r: Rec, name: string) => HEX32.test(s(r, name))

const RULES: Record<Kind, (r: Rec) => boolean> = {
  org: () => true,
  site: (r) => u64(r, "lat_e6") && u64(r, "lng_e6") && u64(r, "people"),
  need: (r) => keyAt(r, "site") && ITEM_SET.has(s(r, "item")) && u64(r, "qty") && u64(r, "urgency") && u64(r, "lat_e6") && u64(r, "lng_e6"),
  pledge: (r) => keyAt(r, "need") && keyAt(r, "site") && ITEM_SET.has(s(r, "item")) && u64(r, "qty") && u64(r, "eta"),
  receipt: (r) => keyAt(r, "pledge") && keyAt(r, "need") && u64(r, "qty"),
  vouch: (r) => ADDRESS.test(s(r, "org")),
}

export function isWellFormed(r: Rec): boolean {
  if (s(r, "app") !== APP) return false
  const kind = s(r, "kind")
  return Object.hasOwn(RULES, kind) && RULES[kind as Kind](r)
}
