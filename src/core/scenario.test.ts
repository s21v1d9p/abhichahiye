import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExpirationTime } from "@arkiv-network/sdk"
import { receiptAttrs } from "./attrs"
import { computeGaps } from "./gaps"
import { createMemChain, type MemChain } from "./memchain"
import { loadDistrict, loadNeed, myEntities } from "./queries"
import { n, s } from "./records"
import { assertScenario, DISTRICT, ROLES, runScenario, type Role, type Wallets } from "./scenario"
import { LIFETIME } from "./schema"
import { isAuthenticNeed, trustedOrgs } from "./trust"
import { createSite, pledgeTo, postNeed, recordReceipt, reconfirmNeed } from "./writes"

let chain: MemChain
let wallets: Wallets

// Fake timers keep Date.now (used by pledgeTo and expiry maths) in step with the chain's blocks.
function tick(seconds: number) {
  chain.advance(BigInt(Math.ceil(seconds / 2)))
  vi.setSystemTime(Date.now() + seconds * 1000)
}

const clock = () => ({ nowUnix: Math.floor(Date.now() / 1000), block: chain.block() })
const board = async () => {
  const data = await loadDistrict(chain.pub, { district: DISTRICT })
  return { data, gaps: computeGaps(data.needs, data.pledges, data.receipts, data.sitesByKey, clock()) }
}
const find = async (gaps: Awaited<ReturnType<typeof board>>["gaps"], campWallet: Role, item: string) =>
  gaps.find((g) => g.need.creator === wallets[campWallet].account.address.toLowerCase() && s(g.need, "item") === item)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-15T08:00:00Z"))
  chain = createMemChain()
  wallets = Object.fromEntries(ROLES.map((role) => [role, chain.wallet()])) as Wallets
})

afterEach(() => {
  vi.useRealTimers()
})

describe("seeded scenario", () => {
  it("builds the story and every assertion about it holds", async () => {
    await runScenario(chain.pub, wallets)
    const results = await assertScenario(chain.pub, wallets)
    expect(results.filter((r) => !r.ok)).toEqual([])
    expect(results.length).toBeGreaterThanOrEqual(6)
  })

  it("shows a gap of 180 for Silapathar's clothes after the pledge of 120", async () => {
    await runScenario(chain.pub, wallets)
    const { gaps } = await board()
    const clothes = await find(gaps, "camp_silapathar", "clothes")
    expect([clothes?.qty, clothes?.pledged, clothes?.gap]).toEqual([300n, 120n, 180n])
  })

  it("has no Jonai food need after the camp recorded delivery, but keeps its receipt", async () => {
    await runScenario(chain.pub, wallets)
    const { data, gaps } = await board()
    expect(await find(gaps, "camp_jonai", "food")).toBeUndefined()
    expect(data.receipts.filter((r) => r.creator === wallets.camp_jonai.account.address.toLowerCase())).toHaveLength(1)
  })

  it("rejects the impostor's need although it points at Silapathar's real site", async () => {
    await runScenario(chain.pub, wallets)
    const { data, gaps } = await board()
    const forged = data.needs.filter((x) => x.creator === wallets.impostor.account.address.toLowerCase())
    expect(forged).toHaveLength(1)
    expect(isAuthenticNeed(forged[0]!, data.sitesByKey)).toBe(false)
    expect(gaps.map((g) => g.need.key)).not.toContain(forged[0]!.key)
    const view = await loadNeed(chain.pub, forged[0]!.key, clock().nowUnix)
    expect(view.state).toBe("forged")
  })

  it("trusts exactly the five orgs the authority vouched for", async () => {
    await runScenario(chain.pub, wallets)
    const { data } = await board()
    const trusted = trustedOrgs(data.vouches, [wallets.authority.account.address])
    const addresses = (roles: Role[]) => roles.map((r) => wallets[r].account.address.toLowerCase()).sort()
    expect([...trusted].sort()).toEqual(
      addresses(["ngo_brahmaputra", "ngo_majuli", "camp_silapathar", "camp_jonai", "camp_dhemaji"]),
    )
  })

  it("is safe to run twice: nothing is duplicated", async () => {
    await runScenario(chain.pub, wallets)
    const count = chain.entityCount()
    await runScenario(chain.pub, wallets)
    expect(chain.entityCount()).toBe(count)
  })

  it("can add a three-minute demo need that disappears by itself", async () => {
    await runScenario(chain.pub, wallets, { demoExpiry: true })
    const demo = (await myEntities(chain.pub, "need", wallets.camp_dhemaji.account.address)).find((x) => s(x, "item") === "sanitary")
    expect(demo).toBeDefined()
    expect(demo!.expiresAt - chain.block()).toBe(90n)
    tick(180)
    expect((await loadNeed(chain.pub, demo!.key, clock().nowUnix)).state).toBe("gone")
  })
})

describe("Entity Expiration over time", () => {
  it("lets urgent needs lapse after six hours unless the camp confirms them again", async () => {
    await runScenario(chain.pub, wallets)
    tick(5 * 3600)
    expect(await find((await board()).gaps, "camp_dhemaji", "water")).toBeDefined()
    tick(1.5 * 3600)
    expect(await find((await board()).gaps, "camp_dhemaji", "water")).toBeUndefined()
    expect(await find((await board()).gaps, "camp_silapathar", "ors")).toBeDefined()
  })

  it("reopens the gap on schedule when a pledge is never delivered", async () => {
    await runScenario(chain.pub, wallets)
    expect((await find((await board()).gaps, "camp_silapathar", "clothes"))?.gap).toBe(180n)
    tick(5 * 3600 + 60)
    const after = await board()
    const clothes = await find(after.gaps, "camp_silapathar", "clothes")
    expect(clothes?.pledged).toBe(0n)
    expect(clothes?.gap).toBe(300n)
  })

  it("keeps the board alive when the scenario is run again on a schedule", async () => {
    await runScenario(chain.pub, wallets)
    for (let i = 0; i < 6; i++) {
      tick(2 * 3600)
      await runScenario(chain.pub, wallets)
    }
    const { gaps } = await board()
    expect(await find(gaps, "camp_dhemaji", "water")).toBeDefined()
    expect(await find(gaps, "camp_silapathar", "clothes")).toBeDefined()
    expect((await find(gaps, "camp_silapathar", "clothes"))?.pledged).toBe(120n)
    expect(await find(gaps, "camp_jonai", "food")).toBeUndefined()
    expect((await assertScenario(chain.pub, wallets)).filter((r) => !r.ok)).toEqual([])
  })
})

describe("lease renewal by activity", () => {
  it("extends the camp listing in the same batch as a re-confirmed need", async () => {
    await runScenario(chain.pub, wallets)
    const camp = wallets.camp_silapathar
    const [site] = await myEntities(chain.pub, "site", camp.account.address)
    tick(4 * 24 * 3600)
    const [aged] = await myEntities(chain.pub, "site", camp.account.address)
    expect(aged!.expiresAt - chain.block()).toBeLessThan(BigInt(LIFETIME.site / 2) - 3600n)
    const [ors] = (await myEntities(chain.pub, "need", camp.account.address)).filter((x) => s(x, "item") === "ors")
    expect(ors).toBeUndefined()
    await postNeed(camp, chain.pub, { site: site!, item: "ors", qty: 200, urgency: 2 })
    const [renewed] = await myEntities(chain.pub, "site", camp.account.address)
    expect(renewed!.expiresAt - chain.block()).toBe(BigInt(LIFETIME.site / 2))
  })

  it("re-confirming a need moves its expiry out to a full lifetime again", async () => {
    await runScenario(chain.pub, wallets)
    const camp = wallets.camp_silapathar
    tick(4 * 3600)
    const [clothes] = (await myEntities(chain.pub, "need", camp.account.address)).filter((x) => s(x, "item") === "clothes")
    expect(clothes!.expiresAt - chain.block()).toBe(BigInt((LIFETIME.need[3] - 4 * 3600) / 2))
    const [org] = await myEntities(chain.pub, "org", camp.account.address)
    await reconfirmNeed(camp, chain.pub, clothes!, org!.key)
    const [again] = (await myEntities(chain.pub, "need", camp.account.address)).filter((x) => s(x, "item") === "clothes")
    expect(again!.expiresAt - chain.block()).toBe(BigInt(LIFETIME.need[3] / 2))
  })
})

describe("settling a pledge through the real writes", () => {
  const clothesNeed = async () => {
    const camp = wallets.camp_silapathar
    const { data } = await board()
    const need = data.needs.find((x) => x.creator === camp.account.address.toLowerCase() && s(x, "item") === "clothes")!
    const pledge = data.pledges.find((x) => s(x, "need") === need.key)!
    return { camp, need, pledge }
  }

  it("ignores a stranger's forged receipt and honours the camp's real one", async () => {
    await runScenario(chain.pub, wallets)
    const { camp, need, pledge } = await clothesNeed()

    const mallory = wallets.impostor
    const fakeSite = await createSite(mallory, { name: "Fake camp", siteType: "camp", state: "AS", district: DISTRICT, lat: 27.6, lng: 94.7, people: 5 })
    await mallory.createEntity({
      payload: new Uint8Array(),
      contentType: "application/octet-stream",
      attributes: receiptAttrs({ pledge: pledge.key, need: need.key, site: fakeSite.entityKey, district: DISTRICT, qty: 120, pledger: pledge.creator }),
      expires: ExpirationTime.fromSeconds(LIFETIME.receipt),
      flags: { readonly: true },
    })
    const forged = (await find((await board()).gaps, "camp_silapathar", "clothes"))!
    expect([forged.qty, forged.pledged, forged.gap]).toEqual([300n, 120n, 180n])

    await recordReceipt(camp, chain.pub, { pledge, need })
    const settled = (await find((await board()).gaps, "camp_silapathar", "clothes"))!
    expect([settled.qty, settled.pledged, settled.gap]).toEqual([180n, 0n, 180n])
  })

  it("refuses to record the same delivery twice", async () => {
    await runScenario(chain.pub, wallets)
    const { camp, need, pledge } = await clothesNeed()
    await recordReceipt(camp, chain.pub, { pledge, need })
    await expect(recordReceipt(camp, chain.pub, { pledge, need })).rejects.toThrow(/already recorded/)
    const [live] = (await myEntities(chain.pub, "need", camp.account.address)).filter((x) => s(x, "item") === "clothes")
    expect(n(live!, "qty")).toBe(180n)
  })

  it("narrows the gap further when a second donor pledges, and stops a non-owner from settling", async () => {
    await runScenario(chain.pub, wallets)
    const { need, pledge } = await clothesNeed()
    await pledgeTo(wallets.ngo_majuli, chain.pub, { need, qty: 50, etaUnix: Math.floor(Date.now() / 1000) + 2 * 3600 })
    expect((await find((await board()).gaps, "camp_silapathar", "clothes"))!.gap).toBe(130n)
    // The donor cannot settle their own pledge: the receipt batch also patches the need, which they do not own.
    await expect(recordReceipt(wallets.ngo_brahmaputra, chain.pub, { pledge, need })).rejects.toThrow(/NotOwner/)
    expect((await find((await board()).gaps, "camp_silapathar", "clothes"))!.gap).toBe(130n)
  })
})

