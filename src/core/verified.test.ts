import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { computeGaps } from "./gaps"
import { createMemChain, type MemChain } from "./memchain"
import { isVouched, loadDistrict, loadVerifiedDistrict } from "./queries"
import { s } from "./records"
import { DISTRICT, ROLES, runScenario, type Wallets } from "./scenario"
import { createSite, pledgeTo, postNeed } from "./writes"

let chain: MemChain
let wallets: Wallets

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-15T08:00:00Z"))
  chain = createMemChain()
  wallets = Object.fromEntries(ROLES.map((role) => [role, chain.wallet()])) as Wallets
})

afterEach(() => {
  vi.useRealTimers()
})

const authority = () => [wallets.authority.account.address]
const clock = (block: bigint) => ({ nowUnix: Math.floor(Date.now() / 1000), block })

// Fake timers keep Date.now (used by pledgeTo and expiry maths) in step with the chain's blocks.
function tick(seconds: number) {
  chain.advance(BigInt(Math.ceil(seconds / 2)))
  vi.setSystemTime(Date.now() + seconds * 1000)
}

// A stranger builds a perfectly self-consistent camp: their own site, their own need, and a pledge against Silapathar.
async function spam() {
  const stranger = chain.wallet()
  const { entityKey } = await createSite(stranger, { name: "Spam camp", siteType: "camp", state: "AS", district: DISTRICT, lat: 27.5, lng: 94.5, people: 10 })
  const site = (await chain.pub.getEntity(entityKey))
  const { toRec } = await import("./records")
  await postNeed(stranger, chain.pub, { site: toRec(site), item: "water", qty: 5000, urgency: 3 })
  return stranger
}

describe("loadVerifiedDistrict", () => {
  it("returns only what wallets vouched for by the authority created", async () => {
    await runScenario(chain.pub, wallets)
    const stranger = await spam()
    const open = await loadDistrict(chain.pub, { district: DISTRICT })
    const verified = await loadVerifiedDistrict(chain.pub, { district: DISTRICT }, authority())

    expect(open.needs.some((x) => x.creator === stranger.account.address.toLowerCase())).toBe(true)
    expect(verified.needs.some((x) => x.creator === stranger.account.address.toLowerCase())).toBe(false)
    expect(verified.sites.some((x) => x.creator === stranger.account.address.toLowerCase())).toBe(false)
    const impostor = wallets.impostor.account.address.toLowerCase()
    expect(verified.needs.some((x) => x.creator === impostor)).toBe(false)
    expect(verified.needs.length).toBeGreaterThanOrEqual(3)
  })

  it("keeps the vouched board intact and reads it all at one block", async () => {
    await runScenario(chain.pub, wallets)
    const verified = await loadVerifiedDistrict(chain.pub, { district: DISTRICT }, authority())
    const gaps = computeGaps(verified.needs, verified.pledges, verified.receipts, verified.sitesByKey, clock(verified.block))
    const clothes = gaps.find((g) => s(g.need, "item") === "clothes")
    expect([clothes?.qty, clothes?.pledged, clothes?.gap]).toEqual([300n, 120n, 180n])
    expect(verified.truncated).toBe(false)
  })

  it("ignores pledges from wallets nobody vouched for", async () => {
    await runScenario(chain.pub, wallets)
    const { data } = { data: await loadDistrict(chain.pub, { district: DISTRICT }) }
    const need = data.needs.find((x) => s(x, "item") === "clothes")!
    const stranger = chain.wallet()
    await pledgeTo(stranger, chain.pub, { need, qty: 100, etaUnix: Math.floor(Date.now() / 1000) + 3600 })

    const open = await loadDistrict(chain.pub, { district: DISTRICT })
    const openGap = computeGaps(open.needs, open.pledges, open.receipts, open.sitesByKey, clock(open.block)).find((g) => s(g.need, "item") === "clothes")
    expect(openGap?.pledged).toBe(220n)

    const verified = await loadVerifiedDistrict(chain.pub, { district: DISTRICT }, authority())
    const verifiedGap = computeGaps(verified.needs, verified.pledges, verified.receipts, verified.sitesByKey, clock(verified.block)).find((g) => s(g.need, "item") === "clothes")
    expect(verifiedGap?.pledged).toBe(120n)
  })

  it("is empty when no authority is trusted or nobody has been vouched for", async () => {
    await runScenario(chain.pub, wallets)
    const none = await loadVerifiedDistrict(chain.pub, { district: DISTRICT }, [])
    expect(none.needs).toEqual([])
    const stranger = chain.wallet().account.address
    const unknownAuthority = await loadVerifiedDistrict(chain.pub, { district: DISTRICT }, [stranger])
    expect(unknownAuthority.needs).toEqual([])
    expect(unknownAuthority.block).toBeGreaterThan(0n)
  })

  it("stops trusting an org once its vouch has lapsed, even though its needs are fresh", async () => {
    await runScenario(chain.pub, wallets)
    tick(30 * 24 * 3600 - 3600)
    await runScenario(chain.pub, wallets)
    expect((await loadVerifiedDistrict(chain.pub, { district: DISTRICT }, authority())).needs.length).toBeGreaterThan(0)

    tick(2 * 3600)
    expect((await loadDistrict(chain.pub, { district: DISTRICT })).needs.length).toBeGreaterThan(0)
    const verified = await loadVerifiedDistrict(chain.pub, { district: DISTRICT }, authority())
    expect(verified.vouches).toEqual([])
    expect(verified.needs).toEqual([])
  })
})

describe("isVouched", () => {
  it("is true only for organisations a trusted authority vouched for", async () => {
    await runScenario(chain.pub, wallets)
    const trusted = authority()
    expect(await isVouched(chain.pub, wallets.camp_silapathar.account.address, trusted)).toBe(true)
    expect(await isVouched(chain.pub, wallets.ngo_majuli.account.address, trusted)).toBe(true)
    expect(await isVouched(chain.pub, wallets.impostor.account.address, trusted)).toBe(false)
    expect(await isVouched(chain.pub, wallets.camp_silapathar.account.address, [])).toBe(false)
    expect(await isVouched(chain.pub, wallets.camp_silapathar.account.address, [chain.wallet().account.address])).toBe(false)
  })
})
