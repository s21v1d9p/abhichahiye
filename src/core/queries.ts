import { NoEntityFoundError } from "@arkiv-network/sdk"
import { key, u64 } from "@arkiv-network/sdk/attr"
import { and, eq, gte, lte, type Expression } from "@arkiv-network/sdk/query"
import type { Hex } from "viem"
import type { PublicClient } from "./arkiv"
import { type Gap, computeGaps } from "./gaps"
import { type Box, slug, toE6 } from "./geo"
import { type Rec, s, toRec } from "./records"
import { APP, type Item, KIND, type Kind } from "./schema"

const PAGE_SIZE = 200
const MAX_RESULTS = 1000

type Scope = { createdBy?: Hex; ownedBy?: Hex }

export type Fetched = { recs: Rec[]; truncated: boolean }

// The SDK's page.next() re-queries at the chain head, and the node rejects a cursor once the head has moved
// (-32005), so later pages are requested by hand, pinned to the block the first page was read at.
// Anyone can write entities that match these queries, so a result cut off at MAX_RESULTS is reported, never hidden.
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
  return { recs, truncated: page.cursor !== undefined }
}

const ofKind = (kind: Kind): Expression[] => [eq("app", APP), eq("kind", kind)]

export type DistrictFilter = { district: string; minUrgency?: 1 | 2 | 3; item?: Item }

export function needsWhere(f: DistrictFilter): Expression[] {
  const where = [...ofKind("need"), eq("district", slug(f.district)), gte("urgency", u64(f.minUrgency ?? 1))]
  if (f.item) where.push(eq("item", f.item))
  return where
}

// All six queries read the same block, so a need, its pledges and their receipts are always seen consistently.
export async function loadDistrict(client: PublicClient, f: DistrictFilter) {
  const block = await client.getBlockNumber()
  const inDistrict = eq("district", slug(f.district))
  const sets = await Promise.all([
    fetchAll(client, needsWhere(f), {}, block),
    fetchAll(client, [...ofKind("pledge"), inDistrict], {}, block),
    fetchAll(client, [...ofKind("receipt"), inDistrict], {}, block),
    fetchAll(client, [...ofKind("site"), inDistrict], {}, block),
    fetchAll(client, ofKind("org"), {}, block),
    fetchAll(client, [...ofKind("vouch"), inDistrict], {}, block),
  ])
  const [needs, pledges, receipts, sites, orgs, vouches] = sets
  return {
    block,
    truncated: sets.some((x) => x.truncated),
    needs: needs.recs,
    pledges: pledges.recs,
    receipts: receipts.recs,
    sites: sites.recs,
    orgs: orgs.recs,
    vouches: vouches.recs,
    sitesByKey: new Map<string, Rec>(sites.recs.map((x) => [x.key, x])),
  }
}

export function boxWhere(b: Box): Expression[] {
  return [
    ...ofKind("need"),
    gte("lat_e6", u64(toE6(b.south))),
    lte("lat_e6", u64(toE6(b.north))),
    gte("lng_e6", u64(toE6(b.west))),
    lte("lng_e6", u64(toE6(b.east))),
  ]
}

// A zoomed-out map can extend past the 0..180 degrees the e6 attributes can hold; nothing exists out there.
const clampDegrees = (deg: number) => Math.min(180, Math.max(0, deg))

export async function needsInBox(client: PublicClient, b: Box): Promise<Rec[]> {
  const box = { south: clampDegrees(b.south), west: clampDegrees(b.west), north: clampDegrees(b.north), east: clampDegrees(b.east) }
  return (await fetchAll(client, boxWhere(box))).recs
}

export async function myEntities(client: PublicClient, kind: Kind, owner: Hex): Promise<Rec[]> {
  return (await fetchAll(client, ofKind(kind), { ownedBy: owner })).recs
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

export type NeedView =
  | { state: "live"; block: bigint; need: Rec; site: Rec; gap: Gap }
  | { state: "gone" }
  | { state: "foreign" }
  | { state: "orphan"; need: Rec }
  | { state: "forged"; need: Rec }

// What a forwarded need link should say: a live need with its current gap, or why nobody should act on it.
// gone = expired, deleted or never existed; foreign = another app's entity; orphan = its camp listing has expired;
// forged = written by a different wallet than the camp listing's creator.
export async function loadNeed(client: PublicClient, needKey: Hex, nowUnix = Math.floor(Date.now() / 1000)): Promise<NeedView> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(needKey)) return { state: "gone" }
  const block = await client.getBlockNumber()
  const need = await liveRec(client, needKey)
  if (!need) return { state: "gone" }
  if (s(need, "app") !== APP || s(need, "kind") !== KIND.need) return { state: "foreign" }
  const site = await liveRec(client, s(need, "site") as Hex)
  if (!site) return { state: "orphan", need }
  if (site.creator !== need.creator) return { state: "forged", need }

  const [pledges, receipts] = await Promise.all([
    fetchAll(client, [...ofKind("pledge"), eq("need", key(needKey))], {}, block),
    fetchAll(client, [...ofKind("receipt"), eq("need", key(needKey))], { createdBy: need.creator }, block),
  ])
  const [gap] = computeGaps([need], pledges.recs, receipts.recs, new Map([[site.key, site]]), { nowUnix, block })
  return gap ? { state: "live", block, need, site, gap } : { state: "forged", need }
}
