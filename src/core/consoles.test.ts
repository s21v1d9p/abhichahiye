import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadCamp, loadDirectory, loadPledges } from "./consoles"
import { createMemChain, type MemChain } from "./memchain"
import { myEntities } from "./queries"
import { s } from "./records"
import { DISTRICT, ROLES, runScenario, type Role, type Wallets } from "./scenario"
import { recordReceipt, withdrawVouch } from "./writes"

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

const address = (role: Role) => wallets[role].account.address

describe("loadCamp", () => {
  it("shows a camp its organisation, its listing and its live needs with the pledges against them", async () => {
    await runScenario(chain.pub, wallets)
    const camp = await loadCamp(chain.pub, address("camp_silapathar"))
    expect(camp.org?.payload.name).toBe("Silapathar Camp Committee (demo)")
    expect(camp.site?.payload.name).toBe("Silapathar relief camp (demo)")
    expect(camp.needs.map((v) => s(v.need, "item")).sort()).toEqual(["clothes", "ors"])
    const clothes = camp.needs.find((v) => s(v.need, "item") === "clothes")!
    expect([clothes.gap.qty, clothes.gap.pledged, clothes.gap.gap]).toEqual([300n, 120n, 180n])
    expect(clothes.gap.openPledges).toHaveLength(1)
  })

  it("is empty for a wallet that has not started", async () => {
    const camp = await loadCamp(chain.pub, chain.wallet().account.address)
    expect(camp).toMatchObject({ org: undefined, site: undefined, needs: [] })
  })

  it("lists needs newest-expiring first, so the one about to lapse is on top", async () => {
    await runScenario(chain.pub, wallets)
    const camp = await loadCamp(chain.pub, address("camp_silapathar"))
    const expiries = camp.needs.map((v) => v.need.expiresAt)
    expect(expiries).toEqual([...expiries].sort((a, b) => (a < b ? -1 : 1)))
  })
})

describe("loadPledges", () => {
  it("shows an open pledge with the need it is for", async () => {
    await runScenario(chain.pub, wallets)
    const [mine, ...rest] = (await loadPledges(chain.pub, address("ngo_brahmaputra"))).views
    expect(rest).toEqual([])
    expect(mine?.status).toBe("open")
    expect(s(mine!.need!, "item")).toBe("clothes")
  })

  it("marks a pledge received once the camp records the delivery", async () => {
    await runScenario(chain.pub, wallets)
    const [before] = (await loadPledges(chain.pub, address("ngo_brahmaputra"))).views
    await recordReceipt(wallets.camp_silapathar, chain.pub, { pledge: before!.pledge, need: before!.need! })
    const [after] = (await loadPledges(chain.pub, address("ngo_brahmaputra"))).views
    expect(after?.status).toBe("received")
  })

  it("still knows a pledge was received after the delivery closed the need", async () => {
    await runScenario(chain.pub, wallets)
    const [food] = (await loadPledges(chain.pub, address("ngo_majuli"))).views
    expect(food?.need).toBeUndefined()
    expect(food?.status).toBe("received")
  })
})

describe("loadDirectory", () => {
  it("lists the district's organisations with who stands behind them", async () => {
    await runScenario(chain.pub, wallets)
    const { rows } = await loadDirectory(chain.pub, DISTRICT, address("authority"), [address("authority")])
    expect(rows).toHaveLength(7)
    const byName = Object.fromEntries(rows.map((r) => [String(r.org.payload.name), r]))
    expect(byName["Silapathar Camp Committee (demo)"]?.vouchedByTrusted).toBe(true)
    expect(byName["Silapathar Camp Committee (demo)"]?.myVouch).toBeDefined()
    expect(byName["Dhemaji Flood Fund (demo)"]?.vouchedByTrusted).toBe(false)
    expect(byName["Dhemaji Flood Fund (demo)"]?.myVouch).toBeUndefined()
  })

  it("does not count a vouch from a wallet the viewer does not trust", async () => {
    await runScenario(chain.pub, wallets)
    const { rows } = await loadDirectory(chain.pub, DISTRICT, undefined, [chain.wallet().account.address])
    expect(rows.every((r) => !r.vouchedByTrusted)).toBe(true)
  })

  it("lets an authority withdraw a vouch, which removes the trust at once", async () => {
    await runScenario(chain.pub, wallets)
    const authority = [address("authority")]
    const silapathar = (r: Awaited<ReturnType<typeof loadDirectory>>["rows"][number]) => r.org.creator === address("camp_silapathar").toLowerCase()
    const before = (await loadDirectory(chain.pub, DISTRICT, address("authority"), authority)).rows.find(silapathar)!
    await withdrawVouch(wallets.authority, before.myVouch!.key)
    const after = (await loadDirectory(chain.pub, DISTRICT, address("authority"), authority)).rows.find(silapathar)!
    expect(after.vouchedByTrusted).toBe(false)
    expect(after.myVouch).toBeUndefined()
    expect(await myEntities(chain.pub, "vouch", address("authority"))).toHaveLength(4)
  })
})
