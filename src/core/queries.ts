import { u64 } from "@arkiv-network/sdk/attr"
import { and, eq, gte, lte, type Expression } from "@arkiv-network/sdk/query"
import type { Hex } from "viem"
import type { PublicClient } from "./arkiv"
import { type Box, slug, toE6 } from "./geo"
import { type Rec, toRec } from "./records"
import { APP, type Item, type Kind } from "./schema"

const PAGE_SIZE = 200
const MAX_RESULTS = 1000

type Scope = { createdBy?: Hex; ownedBy?: Hex }

// Every page of one walk is read at the same block, so results cannot shift while paging.
export async function fetchAll(client: PublicClient, where: Expression[], scope: Scope = {}): Promise<Rec[]> {
  let query = client
    .select({ key: true, owner: true, creator: true, expiresAt: true, attributes: true, payload: true })
    .where(where)
    .limit(PAGE_SIZE)
  if (scope.createdBy) query = query.createdBy(scope.createdBy)
  if (scope.ownedBy) query = query.ownedBy(scope.ownedBy)

  let page = await query.fetch()
  const out = page.entities.map(toRec)
  while (page.hasNextPage() && out.length < MAX_RESULTS) {
    page = await page.next()
    out.push(...page.entities.map(toRec))
  }
  return out
}

const ofKind = (kind: Kind): Expression[] => [eq("app", APP), eq("kind", kind)]

export type DistrictFilter = { district: string; minUrgency?: 1 | 2 | 3; item?: Item }

export function needsWhere(f: DistrictFilter): Expression[] {
  const where = [...ofKind("need"), eq("district", slug(f.district)), gte("urgency", u64(f.minUrgency ?? 1))]
  if (f.item) where.push(eq("item", f.item))
  return where
}

export async function loadDistrict(client: PublicClient, f: DistrictFilter) {
  const inDistrict = eq("district", slug(f.district))
  const [needs, pledges, receipts, sites, orgs, vouches] = await Promise.all([
    fetchAll(client, needsWhere(f)),
    fetchAll(client, [...ofKind("pledge"), inDistrict]),
    fetchAll(client, [...ofKind("receipt"), inDistrict]),
    fetchAll(client, [...ofKind("site"), inDistrict]),
    fetchAll(client, ofKind("org")),
    fetchAll(client, [...ofKind("vouch"), inDistrict]),
  ])
  return { needs, pledges, receipts, sites, orgs, vouches, sitesByKey: new Map(sites.map((x) => [x.key, x])) }
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

export const needsInBox = (client: PublicClient, b: Box) => fetchAll(client, boxWhere(b))

export const myEntities = (client: PublicClient, kind: Kind, owner: Hex) =>
  fetchAll(client, ofKind(kind), { ownedBy: owner })

export const toQueryString = (where: Expression[]): string => and(where).toString()
