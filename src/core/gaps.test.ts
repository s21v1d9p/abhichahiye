import { describe, expect, it } from "vitest"
import { BLOCK_SECONDS } from "./expiry"
import { computeGaps } from "./gaps"
import type { Rec } from "./records"
import { LIFETIME, MAX_QTY } from "./schema"
import type { Clock } from "./trust"

const rec = (key: string, creator: string, attrs: Record<string, string | bigint>, expiresAt = 1n): Rec => ({
  key: key as `0x${string}`,
  creator: creator as `0x${string}`,
  owner: creator as `0x${string}`,
  expiresAt,
  attrs,
  payload: {},
})

const clock: Clock = { nowUnix: 1_760_000_000, block: 1000n }

// A pledge written the way pledgeTo writes it: it lapses two hours after its ETA.
const pledge = (key: string, creator: string, need: string, item: string, qty: bigint, etaOffset = 3600) =>
  rec(
    key,
    creator,
    { need, item, qty, eta: BigInt(clock.nowUnix + etaOffset) },
    clock.block + BigInt((etaOffset + LIFETIME.pledgeGrace) / BLOCK_SECONDS),
  )

const site = rec("0xs1", "0xcamp", { kind: "site" })
const sites = new Map([[site.key, site]])
const clothes = rec("0xn1", "0xcamp", { site: "0xs1", item: "clothes", qty: 300n, urgency: 3n })
const rice = rec("0xn2", "0xcamp", { site: "0xs1", item: "food", qty: 100n, urgency: 1n })
const fake = rec("0xn3", "0xbad", { site: "0xs1", item: "water", qty: 999n, urgency: 3n })
const gaps = (needs: Rec[], pledges: Rec[], receipts: Rec[], known = sites) =>
  computeGaps(needs, pledges, receipts, known, clock)

describe("computeGaps", () => {
  it("subtracts open pledges from need quantity", () => {
    const [g] = gaps([clothes], [pledge("0xp1", "0xngo", "0xn1", "clothes", 120n)], [])
    expect(g!.pledged).toBe(120n)
    expect(g!.gap).toBe(180n)
  })

  it("ignores pledges the camp has settled with its own receipt", () => {
    const r = rec("0xr1", "0xcamp", { pledge: "0xp1", site: "0xs1" })
    const [g] = gaps([clothes], [pledge("0xp1", "0xngo", "0xn1", "clothes", 120n)], [r])
    expect(g!.pledged).toBe(0n)
  })

  it("ignores receipts not created by the camp", () => {
    const forged = rec("0xr9", "0xngo", { pledge: "0xp1", site: "0xs1" })
    const [g] = gaps([clothes], [pledge("0xp1", "0xngo", "0xn1", "clothes", 120n)], [forged])
    expect(g!.pledged).toBe(120n)
  })

  it("ignores a receipt from a wallet that created its own site to look like a camp", () => {
    const attackerSite = rec("0xs9", "0xbad", { kind: "site" })
    const known = new Map([...sites, [attackerSite.key, attackerSite]])
    const forged = rec("0xr7", "0xbad", { pledge: "0xp1", site: "0xs9", need: "0xn1" })
    const [g] = gaps([clothes], [pledge("0xp1", "0xngo", "0xn1", "clothes", 120n)], [forged], known)
    expect(g!.pledged).toBe(120n)
    expect(g!.gap).toBe(180n)
  })

  it("never reports a negative gap", () => {
    const [g] = gaps([clothes], [pledge("0xp1", "0xngo", "0xn1", "clothes", 500n)], [])
    expect(g!.gap).toBe(0n)
  })

  it("drops needs that fail authenticity and sorts by urgency then gap", () => {
    expect(gaps([rice, fake, clothes], [], []).map((g) => g.need.key)).toEqual(["0xn1", "0xn2"])
  })

  it("breaks urgency ties by the larger remaining gap", () => {
    const small = rec("0xn4", "0xcamp", { site: "0xs1", item: "ors", qty: 50n, urgency: 2n })
    const large = rec("0xn5", "0xcamp", { site: "0xs1", item: "water", qty: 500n, urgency: 2n })
    expect(gaps([small, large], [], []).map((g) => g.need.key)).toEqual(["0xn5", "0xn4"])
  })

  it("ignores pledges aimed at a different item than the need", () => {
    const [g] = gaps([clothes], [pledge("0xp2", "0xngo", "0xn1", "food", 120n)], [])
    expect(g!.pledged).toBe(0n)
  })

  it("lists the open pledges that count towards each need", () => {
    const mine = pledge("0xp1", "0xngo", "0xn1", "clothes", 120n)
    const other = pledge("0xp3", "0xngo", "0xn2", "food", 10n)
    const [g] = gaps([clothes], [mine, other], [])
    expect(g!.openPledges.map((x) => x.key)).toEqual(["0xp1"])
  })

  it("does not let a squatting or absurd pledge hide a need", () => {
    const permanent = rec("0xp4", "0xbad", { need: "0xn1", item: "clothes", qty: 300n, eta: BigInt(clock.nowUnix + 3600) }, 2n ** 64n - 1n)
    const farFuture = pledge("0xp5", "0xbad", "0xn1", "clothes", 300n, 90 * 24 * 3600)
    const huge = pledge("0xp6", "0xbad", "0xn1", "clothes", BigInt(MAX_QTY) + 1n)
    const [g] = gaps([clothes], [permanent, farFuture, huge], [])
    expect(g!.pledged).toBe(0n)
    expect(g!.gap).toBe(300n)
  })
})
