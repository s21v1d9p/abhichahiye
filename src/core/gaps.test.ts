import { describe, expect, it } from "vitest"
import { computeGaps } from "./gaps"
import type { Rec } from "./records"

const rec = (key: string, creator: string, attrs: Record<string, string | bigint>): Rec => ({
  key: key as `0x${string}`,
  creator: creator as `0x${string}`,
  owner: creator as `0x${string}`,
  expiresAt: 1n,
  attrs,
  payload: {},
})

const site = rec("0xs1", "0xcamp", { kind: "site" })
const sites = new Map([[site.key, site]])
const clothes = rec("0xn1", "0xcamp", { site: "0xs1", item: "clothes", qty: 300n, urgency: 3n })
const rice = rec("0xn2", "0xcamp", { site: "0xs1", item: "food", qty: 100n, urgency: 1n })
const fake = rec("0xn3", "0xbad", { site: "0xs1", item: "water", qty: 999n, urgency: 3n })

describe("computeGaps", () => {
  it("subtracts open pledges from need quantity", () => {
    const p = rec("0xp1", "0xngo", { need: "0xn1", item: "clothes", qty: 120n })
    const [g] = computeGaps([clothes], [p], [], sites)
    expect(g.pledged).toBe(120n)
    expect(g.gap).toBe(180n)
  })

  it("ignores pledges already fulfilled by a valid receipt", () => {
    const p = rec("0xp1", "0xngo", { need: "0xn1", item: "clothes", qty: 120n })
    const r = rec("0xr1", "0xcamp", { pledge: "0xp1", site: "0xs1" })
    expect(computeGaps([clothes], [p], [r], sites)[0].pledged).toBe(0n)
  })

  it("ignores receipts not created by the camp", () => {
    const p = rec("0xp1", "0xngo", { need: "0xn1", item: "clothes", qty: 120n })
    const forged = rec("0xr9", "0xngo", { pledge: "0xp1", site: "0xs1" })
    expect(computeGaps([clothes], [p], [forged], sites)[0].pledged).toBe(120n)
  })

  it("never reports a negative gap", () => {
    const p = rec("0xp1", "0xngo", { need: "0xn1", item: "clothes", qty: 500n })
    expect(computeGaps([clothes], [p], [], sites)[0].gap).toBe(0n)
  })

  it("drops needs that fail authenticity and sorts by urgency then gap", () => {
    const gaps = computeGaps([rice, fake, clothes], [], [], sites)
    expect(gaps.map((g) => g.need.key)).toEqual(["0xn1", "0xn2"])
  })

  it("breaks urgency ties by the larger remaining gap", () => {
    const small = rec("0xn4", "0xcamp", { site: "0xs1", item: "ors", qty: 50n, urgency: 2n })
    const large = rec("0xn5", "0xcamp", { site: "0xs1", item: "water", qty: 500n, urgency: 2n })
    expect(computeGaps([small, large], [], [], sites).map((g) => g.need.key)).toEqual(["0xn5", "0xn4"])
  })

  it("ignores pledges aimed at a different item than the need", () => {
    const wrong = rec("0xp2", "0xngo", { need: "0xn1", item: "food", qty: 120n })
    expect(computeGaps([clothes], [wrong], [], sites)[0].pledged).toBe(0n)
  })

  it("lists the open pledges that count towards each need", () => {
    const p = rec("0xp1", "0xngo", { need: "0xn1", item: "clothes", qty: 120n })
    const other = rec("0xp3", "0xngo", { need: "0xn2", item: "food", qty: 10n })
    const [g] = computeGaps([clothes], [p, other], [], sites)
    expect(g.openPledges.map((x) => x.key)).toEqual(["0xp1"])
  })
})
