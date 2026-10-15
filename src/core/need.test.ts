import { NoEntityFoundError } from "@arkiv-network/sdk"
import type { Expression } from "@arkiv-network/sdk/query"
import { describe, expect, it } from "vitest"
import type { Hex } from "viem"
import type { PublicClient } from "./arkiv"
import { loadNeed, toQueryString } from "./queries"
import type { Rec } from "./records"

const CAMP = `0x${"c".repeat(40)}` as Hex
const NGO = `0x${"d".repeat(40)}` as Hex
const STRANGER = `0x${"e".repeat(40)}` as Hex
const SITE = `0x${"a".repeat(64)}` as Hex
const NEED = `0x${"b".repeat(64)}` as Hex
const PLEDGE = `0x${"f".repeat(64)}` as Hex
const NOW = 1_760_000_000
const BLOCK = 500n

const rec = (key: Hex, creator: Hex, attrs: Record<string, string | bigint>, expiresAt = 100_000n): Rec => ({
  key,
  creator,
  owner: creator,
  expiresAt,
  attrs: { app: "abhichahiye", ...attrs },
  payload: {},
})
const site = rec(SITE, CAMP, { kind: "site", district: "dhemaji" })
const need = rec(NEED, CAMP, { kind: "need", site: SITE, item: "clothes", qty: 300n, urgency: 3n, district: "dhemaji" })
const pledge = rec(PLEDGE, NGO, { kind: "pledge", need: NEED, item: "clothes", qty: 120n, eta: BigInt(NOW + 3600) }, BLOCK + 5400n)
const receipt = (creator: Hex) => rec(`0x${"9".repeat(64)}` as Hex, creator, { kind: "receipt", pledge: PLEDGE, need: NEED })

const entityOf = (r: Rec) => ({
  key: r.key,
  creator: r.creator,
  owner: r.owner,
  expiresAt: r.expiresAt,
  attributes: Object.fromEntries(
    Object.entries(r.attrs).map(([name, value]) => [name, typeof value === "bigint" ? { type: "u64", value } : { type: "str", value }]),
  ),
  payload: new Uint8Array(),
})

function chainWith(opts: { live: Rec[]; pledges?: Rec[]; receipts?: Rec[] }) {
  const byKey = new Map(opts.live.map((r) => [r.key, r]))
  const select = () => {
    let where: Expression[] = []
    const builder = {
      where: (w: Expression[]) => {
        where = w
        return builder
      },
      limit: () => builder,
      atBlock: () => builder,
      cursor: () => builder,
      createdBy: () => builder,
      ownedBy: () => builder,
      fetch: async () => {
        const q = toQueryString(where)
        const list = q.includes("kind = str('pledge')") ? opts.pledges : q.includes("kind = str('receipt')") ? opts.receipts : []
        return { entities: (list ?? []).map(entityOf), blockNumber: BLOCK, cursor: undefined }
      },
    }
    return builder
  }
  return {
    getBlockNumber: async () => BLOCK,
    getEntity: async (key: Hex) => {
      const found = byKey.get(key)
      if (!found) throw new NoEntityFoundError(key)
      return entityOf(found)
    },
    select,
  } as unknown as PublicClient
}

describe("loadNeed", () => {
  it("returns a live need with its gap after open pledges", async () => {
    const view = await loadNeed(chainWith({ live: [need, site], pledges: [pledge] }), NEED, NOW)
    expect(view.state).toBe("live")
    if (view.state !== "live") return
    expect(view.gap.qty).toBe(300n)
    expect(view.gap.pledged).toBe(120n)
    expect(view.gap.gap).toBe(180n)
    expect(view.site.key).toBe(SITE)
    expect(view.block).toBe(BLOCK)
  })

  it("reopens the gap only when the camp itself settles the pledge", async () => {
    const byStranger = await loadNeed(chainWith({ live: [need, site], pledges: [pledge], receipts: [receipt(STRANGER)] }), NEED, NOW)
    const byCamp = await loadNeed(chainWith({ live: [need, site], pledges: [pledge], receipts: [receipt(CAMP)] }), NEED, NOW)
    expect(byStranger.state === "live" && byStranger.gap.gap).toBe(180n)
    expect(byCamp.state === "live" && byCamp.gap.gap).toBe(300n)
  })

  it("says gone for an expired, deleted or unknown need", async () => {
    expect((await loadNeed(chainWith({ live: [site] }), NEED, NOW)).state).toBe("gone")
  })

  it("says gone for a link that is not even a valid key", async () => {
    expect((await loadNeed(chainWith({ live: [] }), "0x1234" as Hex, NOW)).state).toBe("gone")
  })

  it("rejects entities that belong to another app", async () => {
    const other = { ...need, attrs: { ...need.attrs, app: "someone-else" } }
    expect((await loadNeed(chainWith({ live: [other, site] }), NEED, NOW)).state).toBe("foreign")
  })

  it("flags a need whose camp listing has expired", async () => {
    expect((await loadNeed(chainWith({ live: [need] }), NEED, NOW)).state).toBe("orphan")
  })

  it("flags a need written by a different wallet than the camp listing's creator", async () => {
    const forged = { ...need, creator: STRANGER, owner: STRANGER }
    expect((await loadNeed(chainWith({ live: [forged, site] }), NEED, NOW)).state).toBe("forged")
  })
})
