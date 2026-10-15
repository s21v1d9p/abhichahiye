import { NoEntityFoundError } from "@arkiv-network/sdk"
import { addr, key, u64 } from "@arkiv-network/sdk/attr"
import { and, eq, gte, lte, or, type Expression } from "@arkiv-network/sdk/query"
import type { Hex } from "viem"
import type { PublicClient } from "./arkiv"
import { type Gap, computeGaps } from "./gaps"
import { type Box, slug, toE6 } from "./geo"
import { n, type Rec, s, toRec } from "./records"
import { APP, type Item, KIND, type Kind } from "./schema"
import { isAuthenticNeed, trustedOrgs } from "./trust"
import { isWellFormed } from "./shape"

// Every arkiv_query costs 100 units of the caller's budget however many entities it returns, and getEntity is a query
// too (see arkiv/friction.md). So each view is built from as few queries as possible: one for a whole district, one
// for a map viewport, two for a forwarded need link.

const PAGE_SIZE = 200
const MAX_RESULTS = 1000
// The longest OR list put in one predicate; 40 clauses were verified on Tiramisu.
export const MAX_OR = 40

type Scope = { createdBy?: Hex; ownedBy?: Hex }

export type Fetched = { recs: Rec[]; truncated: boolean; block: bigint }

// The SDK's page.next() re-queries at the chain head, and the node rejects a cursor once the head has moved
// (-32005), so later pages are requested by hand, pinned to the block the first page was read at.
// Anyone can write entities that match these queries, so a result cut off at MAX_RESULTS is reported, never hidden.
// Views that need several queries pass the first one's block to the rest, so they all read one consistent state.
// (getBlockNumber is no substitute: viem caches it for seconds, so a read right after a write would miss the write.)
export async function fetchAll(
  client: PublicClient,
  where: Expression[],
  scope: Scope = {},
  atBlock?: bigint,
): Promise<Fetched> {
  const build = () => {
    let query = client
      .select({ key: true, owner: true, creator: true, expiresAt: true, attributes: true, payload: true })
      .where(where)
      .limit(PAGE_SIZE)
    if (atBlock !== undefined) query = query.atBlock(atBlock)
    if (scope.createdBy) query = query.createdBy(scope.createdBy)
    if (scope.ownedBy) query = query.ownedBy(scope.ownedBy)
    return query
  }

  let page = await build().fetch()
  const pinned = page.blockNumber
  const recs = page.entities.map(toRec)
  while (page.cursor !== undefined && recs.length < MAX_RESULTS) {
    page = await build().atBlock(pinned).cursor(page.cursor).fetch()
    recs.push(...page.entities.map(toRec))
  }
  return { recs, truncated: page.cursor !== undefined, block: pinned }
}

const app = eq("app", APP)
export const ofKind = (kind: Kind): Expression[] => [app, eq("kind", kind)]
export const byCreator = (wallets: readonly string[]) => or(wallets.map((w) => eq("$creator", addr(w as Hex))))

export type ByKind = Record<Kind, Rec[]>

// Only well-formed entities of a known kind reach a view (see shape.ts).
export function byKind(recs: Rec[]): ByKind {
  const out: ByKind = { org: [], site: [], need: [], pledge: [], receipt: [], vouch: [] }
  for (const r of recs) if (isWellFormed(r)) out[s(r, "kind") as Kind].push(r)
  return out
}

export type DistrictFilter = { district: string; minUrgency?: 1 | 2 | 3; item?: Item }

// Needs, pledges, receipts, sites, organisations and vouches all carry their district, so one query returns a board.
export const districtWhere = (district: string): Expression[] => [app, eq("district", slug(district))]

const wanted = (f: DistrictFilter) => (need: Rec) => n(need, "urgency") >= BigInt(f.minUrgency ?? 1) && (!f.item || s(need, "item") === f.item)

export type DistrictData = {
  block: bigint
  truncated: boolean
  needs: Rec[]
  pledges: Rec[]
  receipts: Rec[]
  sites: Rec[]
  orgs: Rec[]
  vouches: Rec[]
  sitesByKey: Map<string, Rec>
}

function assemble(block: bigint, truncated: boolean, k: Partial<ByKind>): DistrictData {
  const sites = k.site ?? []
  return {
    block,
    truncated,
    needs: k.need ?? [],
    pledges: k.pledge ?? [],
    receipts: k.receipt ?? [],
    sites,
    orgs: k.org ?? [],
    vouches: k.vouch ?? [],
    sitesByKey: new Map<string, Rec>(sites.map((x) => [x.key, x])),
  }
}

// A need shows the name of the organisation that confirmed it. Most are registered in the same district and arrive
// with it; the rest take one more query, by creator.
async function withNames(client: PublicClient, orgs: Rec[], creators: Hex[], block: bigint): Promise<Fetched> {
  const known = new Set<string>(orgs.map((o) => o.creator))
  const missing = [...new Set(creators)].filter((c) => !known.has(c)).slice(0, MAX_OR)
  if (missing.length === 0) return { recs: orgs, truncated: false, block }
  const more = await fetchAll(client, [...ofKind("org"), byCreator(missing)], {}, block)
  return { recs: [...orgs, ...more.recs], truncated: more.truncated, block }
}

export async function loadDistrict(client: PublicClient, f: DistrictFilter): Promise<DistrictData> {
  const all = await fetchAll(client, districtWhere(f.district))
  const k = byKind(all.recs)
  const orgs = await withNames(client, k.org, k.need.map((x) => x.creator), all.block)
  return assemble(all.block, all.truncated || orgs.truncated, { ...k, need: k.need.filter(wanted(f)), org: orgs.recs })
}

// The verified board. Its queries are scoped by $creator to wallets that a trusted authority vouched for, so entities
// written by anyone else, however well-formed and however many, never reach it.
export async function loadVerifiedDistrict(client: PublicClient, f: DistrictFilter, authorities: Hex[]): Promise<DistrictData> {
  if (authorities.length === 0) return assemble(await client.getBlockNumber({ cacheTime: 0 }), false, {})
  const vouches = await fetchAll(client, [...districtWhere(f.district), eq("kind", KIND.vouch), byCreator(authorities.slice(0, MAX_OR))])
  const block = vouches.block
  const trusted = [...trustedOrgs(vouches.recs, authorities)]
  if (trusted.length === 0) return assemble(block, vouches.truncated, { vouch: vouches.recs })

  const rest = await fetchAll(client, [...districtWhere(f.district), byCreator(trusted.slice(0, MAX_OR))], {}, block)
  const k = byKind(rest.recs)
  const orgs = await withNames(client, k.org, k.need.map((x) => x.creator), block)
  const truncated = vouches.truncated || rest.truncated || orgs.truncated || trusted.length > MAX_OR
  return assemble(block, truncated, { ...k, need: k.need.filter(wanted(f)), org: orgs.recs, vouch: vouches.recs })
}

// Needs and sites both carry coordinates, so one numeric range query returns a map viewport's camps and their needs.
export function boxWhere(b: Box): Expression[] {
  return [
    app,
    gte("lat_e6", u64(toE6(b.south))),
    lte("lat_e6", u64(toE6(b.north))),
    gte("lng_e6", u64(toE6(b.west))),
    lte("lng_e6", u64(toE6(b.east))),
  ]
}

// A zoomed-out map can extend past the 0..180 degrees the e6 attributes can hold; nothing exists out there.
const clampDegrees = (deg: number) => Math.min(180, Math.max(0, deg))
const clampBox = (b: Box): Box => ({ south: clampDegrees(b.south), west: clampDegrees(b.west), north: clampDegrees(b.north), east: clampDegrees(b.east) })

export async function loadBox(client: PublicClient, b: Box) {
  const box = clampBox(b)
  const all = await fetchAll(client, boxWhere(box))
  const k = byKind(all.recs)
  const sitesByKey = new Map<string, Rec>(k.site.map((x) => [x.key, x]))
  return { block: all.block, truncated: all.truncated, needs: k.need.filter((x) => isAuthenticNeed(x, sitesByKey)), sites: k.site, sitesByKey }
}

// Ownership can be handed to any wallet without its consent; the creator cannot be faked. So "mine" means "I created it".
export async function myEntities(client: PublicClient, kind: Kind, wallet: Hex): Promise<Rec[]> {
  return (await fetchAll(client, ofKind(kind), { createdBy: wallet })).recs
}

export const toQueryString = (where: Expression[]): string => and(where).toString()

// getEntity throws once an entity has expired or been deleted; for callers here that is an ordinary state.
export async function liveRec(client: PublicClient, entityKey: Hex): Promise<Rec | undefined> {
  try {
    return toRec(await client.getEntity(entityKey))
  } catch (error) {
    if (error instanceof NoEntityFoundError) return undefined
    throw error
  }
}

// Whether this camp already wrote a receipt for the pledge; receipts by anyone else never count.
export async function receiptExists(client: PublicClient, pledge: Hex, camp: Hex): Promise<boolean> {
  const page = await client
    .select({ key: true })
    .where([...ofKind("receipt"), eq("pledge", key(pledge))])
    .createdBy(camp)
    .limit(1)
    .fetch()
  return page.entities.length > 0
}

// Whether a live vouch for this organisation was created by one of the wallets the viewer trusts.
export async function isVouched(client: PublicClient, org: Hex, authorities: Hex[]): Promise<boolean> {
  if (authorities.length === 0) return false
  const page = await client
    .select({ key: true })
    .where([...ofKind("vouch"), eq("org", addr(org)), byCreator(authorities.slice(0, MAX_OR))])
    .limit(1)
    .fetch()
  return page.entities.length > 0
}

export type NeedView =
  | { state: "live"; block: bigint; need: Rec; site: Rec; gap: Gap; orgName: string; vouched: boolean; truncated: boolean }
  | { state: "gone" }
  | { state: "foreign" }
  | { state: "orphan"; need: Rec }
  | { state: "forged"; need: Rec }

const KEY = /^0x[0-9a-fA-F]{64}$/

// What a forwarded need link should say: a live need with its current gap, or why nobody should act on it.
// gone = expired, deleted or never existed; foreign = not a well-formed AbhiChahiye need; orphan = its camp listing has
// expired; forged = written by a different wallet than the camp listing's creator. Two queries, both at one block.
export async function loadNeed(client: PublicClient, needKey: Hex, nowUnix = Math.floor(Date.now() / 1000), authorities: Hex[] = []): Promise<NeedView> {
  if (!KEY.test(needKey)) return { state: "gone" }
  const k = needKey.toLowerCase() as Hex

  // The need itself, and every pledge and receipt that names it.
  const first = await fetchAll(client, [or(eq("$key", key(k)), and(app, eq("need", key(k))))])
  const block = first.block
  // Anyone can write entities that name this need. If they push the need itself out of the result, read it by key.
  const need = first.recs.find((r) => r.key === k) ?? (first.truncated ? await liveRec(client, k) : undefined)
  if (!need) return { state: "gone" }
  if (!isWellFormed(need) || s(need, "kind") !== KIND.need) return { state: "foreign" }
  const siteKey = s(need, "site")

  // Its camp listing, the organisation that confirmed it, and any vouch for that organisation by a trusted authority.
  const vouch = authorities.length > 0 ? [and(app, eq("kind", KIND.vouch), eq("org", addr(need.creator)), byCreator(authorities.slice(0, MAX_OR)))] : []
  const second = await fetchAll(client, [or(eq("$key", key(siteKey as Hex)), and(app, eq("kind", KIND.org), eq("$creator", addr(need.creator))), ...vouch)], {}, block)
  const site = second.recs.find((r) => r.key === siteKey && isWellFormed(r) && s(r, "kind") === KIND.site)
  if (!site) return { state: "orphan", need }
  if (site.creator !== need.creator) return { state: "forged", need }

  const named = byKind(first.recs)
  // Only the camp's own receipts settle a pledge. If junk crowded them out of the result, ask for them by creator.
  const receipts = first.truncated
    ? (await fetchAll(client, [...ofKind("receipt"), eq("need", key(k))], { createdBy: need.creator }, block)).recs.filter(isWellFormed)
    : named.receipt.filter((r) => r.creator === need.creator)
  const [gap] = computeGaps([need], named.pledge, receipts, new Map([[site.key, site]]), { nowUnix, block })
  if (!gap) return { state: "forged", need }
  const about = byKind(second.recs)
  return {
    state: "live",
    block,
    need,
    site,
    gap,
    orgName: String(about.org.find((o) => o.creator === need.creator)?.payload.name ?? ""),
    vouched: trustedOrgs(about.vouch, authorities).has(need.creator as Hex),
    truncated: first.truncated || second.truncated,
  }
}
