import { key } from "@arkiv-network/sdk/attr"
import { and, eq, or } from "@arkiv-network/sdk/query"
import type { Hex } from "viem"
import type { PublicClient } from "./arkiv"
import { computeGaps } from "./gaps"
import { byKind, districtWhere, type Fetched, fetchAll, MAX_OR, type NeedView, ofKind } from "./queries"
import { n, type Rec, s } from "./records"
import { APP, KIND } from "./schema"
import { isWellFormed } from "./shape"
import { trustedOrgs } from "./trust"

// What each console shows its own wallet, in one or two queries per view. The browser keeps nothing but its key.

export type LiveNeed = Extract<NeedView, { state: "live" }>
export type CampView = { block: bigint; truncated: boolean; org: Rec | undefined; site: Rec | undefined; needs: LiveNeed[] }

const app = eq("app", APP)
const unixNow = () => Math.floor(Date.now() / 1000)
const byExpiry = (a: LiveNeed, b: LiveNeed) => (a.need.expiresAt === b.need.expiresAt ? 0 : a.need.expiresAt < b.need.expiresAt ? -1 : 1)

// Everything this wallet created, then every pledge and receipt that names one of its needs, at the same block.
// By creator, not owner: anyone can hand an entity to this wallet, but nobody can make it the creator.
export async function loadCamp(client: PublicClient, wallet: Hex, nowUnix = unixNow()): Promise<CampView> {
  const mine = await fetchAll(client, [app], { createdBy: wallet })
  const block = mine.block
  const own = byKind(mine.recs)
  const needKeys = own.need.map((x) => x.key).slice(0, MAX_OR)
  const named: Fetched = needKeys.length > 0 ? await fetchAll(client, [app, or(needKeys.map((k) => eq("need", key(k))))], {}, block) : { recs: [], truncated: false, block }
  const related = byKind(named.recs)
  // Only this camp's own receipts settle its pledges, and they all came back with everything it created.
  const receipts = own.receipt
  const sitesByKey = new Map<string, Rec>(own.site.map((x) => [x.key, x]))
  const gaps = computeGaps(own.need, related.pledge, receipts, sitesByKey, { nowUnix, block })
  const org = own.org[0]
  const truncated = mine.truncated || named.truncated || own.need.length > MAX_OR
  const needs = gaps.flatMap((gap): LiveNeed[] => {
    const site = sitesByKey.get(s(gap.need, "site"))
    return site ? [{ state: "live", block, need: gap.need, site, gap, orgName: String(org?.payload.name ?? ""), vouched: false, truncated }] : []
  })
  return { block, truncated, org, site: own.site[0], needs: needs.sort(byExpiry) }
}

export type PledgeView = { pledge: Rec; need: Rec | undefined; site: Rec | undefined; status: "open" | "received" | "need gone" }

// Three OR clauses per pledge (its need, its site, receipts naming it), so pledges are looked up 13 at a time.
const PER_QUERY = Math.floor(MAX_OR / 3)

// A pledge counts as received only if the camp itself wrote the receipt. When a full delivery has already closed the
// need, the camp is still known from the site the donor's own pledge names.
export async function loadPledges(client: PublicClient, wallet: Hex): Promise<{ block: bigint; truncated: boolean; views: PledgeView[] }> {
  const mine = await fetchAll(client, ofKind(KIND.pledge), { createdBy: wallet })
  const block = mine.block
  let truncated = mine.truncated
  const pledges = mine.recs.filter(isWellFormed)
  const views: PledgeView[] = []
  for (let i = 0; i < pledges.length; i += PER_QUERY) {
    const chunk = pledges.slice(i, i + PER_QUERY)
    const clauses = chunk.flatMap((p) => [
      eq("$key", key(s(p, "need") as Hex)),
      eq("$key", key(s(p, "site") as Hex)),
      and(app, eq("kind", KIND.receipt), eq("pledge", key(p.key))),
    ])
    const found = await fetchAll(client, [or(clauses)], {}, block)
    truncated ||= found.truncated
    const related = found.recs.filter(isWellFormed)
    const of = (k: string, kind: string) => related.find((r) => r.key === k && s(r, "kind") === kind)
    for (const pledge of chunk) {
      const need = of(s(pledge, "need"), KIND.need)
      const site = of(s(pledge, "site"), KIND.site)
      const camp = need?.creator ?? site?.creator
      const received = !!camp && related.some((r) => s(r, "kind") === KIND.receipt && s(r, "pledge") === pledge.key && r.creator === camp)
      views.push({ pledge, need, site, status: received ? "received" : need ? "open" : "need gone" })
    }
  }
  return { block, truncated, views: views.sort((a, b) => Number(n(a.pledge, "eta") - n(b.pledge, "eta"))) }
}

export type OrgRow = { org: Rec; vouchedByTrusted: boolean; myVouch: Rec | undefined }

// The district office's view: every organisation registered in the district, whether an authority the viewer trusts
// stands behind it, and the viewer's own vouch, if any. One query.
export async function loadDirectory(client: PublicClient, district: string, me: Hex | undefined, authorities: Hex[]) {
  const all = await fetchAll(client, [...districtWhere(district), or(eq("kind", KIND.org), eq("kind", KIND.vouch))])
  const block = all.block
  const { org: orgs, vouch: vouches } = byKind(all.recs)
  const trusted = trustedOrgs(vouches, authorities)
  const mine = me ? vouches.filter((v) => v.creator === me.toLowerCase()) : []
  const rows: OrgRow[] = orgs.map((org) => ({
    org,
    vouchedByTrusted: trusted.has(org.creator),
    myVouch: mine.find((v) => s(v, "org") === org.creator),
  }))
  return { block, truncated: all.truncated, rows }
}
