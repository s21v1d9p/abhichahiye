import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMemChain, type MemChain } from "./memchain"
import { loadBox } from "./queries"
import { s } from "./records"
import { ROLES, runScenario, type Wallets } from "./scenario"

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

const assam = { south: 24, west: 89, north: 29, east: 97 }

describe("loadBox", () => {
  it("returns the authentic needs and camps inside the viewport", async () => {
    await runScenario(chain.pub, wallets)
    const view = await loadBox(chain.pub, assam)
    expect(view.sites).toHaveLength(3)
    expect(view.needs.map((x) => s(x, "item")).sort()).toEqual(["clothes", "ors", "tarpaulin", "water"])
    expect(view.needs.some((x) => x.creator === wallets.impostor.account.address.toLowerCase())).toBe(false)
    expect(view.truncated).toBe(false)
  })

  it("leaves out camps and needs outside the viewport", async () => {
    await runScenario(chain.pub, wallets)
    const aroundJonai = await loadBox(chain.pub, { south: 27.7, west: 95, north: 28, east: 95.5 })
    expect(aroundJonai.sites).toHaveLength(1)
    expect(aroundJonai.needs.map((x) => s(x, "item"))).toEqual(["tarpaulin"])
    const nowhere = await loadBox(chain.pub, { south: 8, west: 76, north: 9, east: 77 })
    expect(nowhere.sites).toEqual([])
    expect(nowhere.needs).toEqual([])
  })

  it("clamps a zoomed-out viewport instead of failing", async () => {
    await runScenario(chain.pub, wallets)
    const world = await loadBox(chain.pub, { south: -85, west: -180, north: 85, east: 180 })
    expect(world.needs.length).toBeGreaterThan(0)
  })
})
