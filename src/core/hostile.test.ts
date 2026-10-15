import { ExpirationTime } from "@arkiv-network/sdk"
import { key, str, u64 } from "@arkiv-network/sdk/attr"
import { jsonToPayload } from "@arkiv-network/sdk/utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Hex } from "viem"
import type { WalletClient } from "./arkiv"
import { siteAttrs } from "./attrs"
import { loadCamp, loadPledges } from "./consoles"
import { createMemChain, type MemChain } from "./memchain"
import { byKind, loadDistrict, loadNeed } from "./queries"
import { s, toRec } from "./records"
import { DISTRICT, ROLES, runScenario, type Wallets } from "./scenario"
import { createSite, pledgeTo, postNeed, recordReceipt } from "./writes"

// Arkiv is permissionless: anyone can write any attributes and any payload. None of it may break a reader.

let chain: MemChain
let wallets: Wallets
let mallory: WalletClient

const raw = (attributes: Record<string, ReturnType<typeof str>>, payload: Uint8Array = jsonToPayload({})) =>
  mallory.createEntity({ payload, contentType: "application/json", attributes, expires: ExpirationTime.fromSeconds(3600) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-15T08:00:00Z"))
  chain = createMemChain()
  wallets = Object.fromEntries(ROLES.map((role) => [role, chain.wallet()])) as Wallets
  mallory = chain.wallet()
})

afterEach(() => {
  vi.useRealTimers()
})

const app = str("abhichahiye")
const district = str(DISTRICT)

describe("toRec", () => {
  it("keeps only a JSON object as the payload", () => {
    const base = { key: `0x${"1".repeat(64)}` as Hex, creator: `0x${"2".repeat(40)}` as Hex, owner: `0x${"2".repeat(40)}` as Hex, expiresAt: 1n }
    for (const text of ["null", "[1,2]", '"text"', "42", "{oops"]) {
      expect(toRec({ ...base, payload: new TextEncoder().encode(text) }).payload).toEqual({})
    }
    expect(toRec({ ...base, payload: new TextEncoder().encode('{"name":"x"}') }).payload).toEqual({ name: "x" })
  })
})

describe("byKind", () => {
  it("drops unknown kinds, including names inherited from Object.prototype", () => {
    const rec = (kind: string) => ({ key: `0x${"1".repeat(64)}`, creator: "0x1", owner: "0x1", expiresAt: 1n, attrs: { app: "abhichahiye", kind }, payload: {} }) as never
    const out = byKind([rec("constructor"), rec("__proto__"), rec("toString"), rec("hasOwnProperty")])
    expect(Object.values(out).flat()).toEqual([])
  })
})

describe("hostile entities", () => {
  it("a district board survives a null payload, a prototype-named kind and an unknown item", async () => {
    await runScenario(chain.pub, wallets)
    await raw({ app, kind: str("org"), district, org_type: str("ngo") }, new TextEncoder().encode("null"))
    await raw({ app, kind: str("constructor"), district })
    const { entityKey: site } = await mallory.createEntity({
      payload: jsonToPayload({ name: "x" }),
      contentType: "application/json",
      attributes: siteAttrs({ siteType: "camp", state: "AS", district: DISTRICT, lat: 27.5, lng: 94.5, people: 1 }),
      expires: ExpirationTime.fromSeconds(3600),
    })
    await raw({ app, kind: str("need"), district, site: key(site), item: str("plutonium"), qty: u64(1n), urgency: u64(3n), lat_e6: u64(27_500_000n), lng_e6: u64(94_500_000n) } as never)

    const data = await loadDistrict(chain.pub, { district: DISTRICT })
    expect(data.orgs.every((o) => o.payload !== null && typeof o.payload === "object")).toBe(true)
    expect(data.needs.some((x) => s(x, "item") === "plutonium")).toBe(false)
    expect(data.needs.length).toBeGreaterThanOrEqual(4)
  })

  it("a need link survives junk that names the need", async () => {
    await runScenario(chain.pub, wallets)
    const need = (await loadDistrict(chain.pub, { district: DISTRICT })).needs.find((x) => s(x, "item") === "clothes")!
    await raw({ app, kind: str("constructor"), need: key(need.key) } as never)
    await raw({ app, kind: str("pledge"), need: key(need.key) } as never)
    const view = await loadNeed(chain.pub, need.key)
    expect(view.state).toBe("live")
  })

  it("the camp console ignores a site that a stranger transferred to the camp's wallet", async () => {
    const camp = wallets.camp_silapathar
    const { entityKey: own } = await createSite(camp, { name: "Real camp", siteType: "camp", state: "AS", district: DISTRICT, lat: 27.5, lng: 94.5, people: 10 })
    const { entityKey: planted } = await createSite(mallory, { name: "Planted camp", siteType: "camp", state: "AS", district: DISTRICT, lat: 27.6, lng: 94.6, people: 10 })
    await mallory.changeOwnership({ entityKey: planted, newOwner: camp.account.address })
    const site = toRec(await chain.pub.getEntity(own))
    await postNeed(camp, chain.pub, { site, item: "water", qty: 10, urgency: 3 })

    const view = await loadCamp(chain.pub, camp.account.address)
    expect(view.site?.key).toBe(own.toLowerCase())
    expect(view.needs).toHaveLength(1)
  })

  it("the donor console survives a malformed pledge handed to the donor's wallet", async () => {
    await runScenario(chain.pub, wallets)
    const donor = wallets.ngo_brahmaputra
    const { entityKey } = await raw({ app, kind: str("pledge"), district })
    await mallory.changeOwnership({ entityKey, newOwner: donor.account.address })
    const { views } = await loadPledges(chain.pub, donor.account.address)
    expect(views.map((v) => s(v.need!, "item"))).toEqual(["clothes"])
  })

  it("a camp's receipt still settles its pledge when a thousand junk entities name the need first", async () => {
    const camp = wallets.camp_silapathar
    const { entityKey: siteKey } = await createSite(camp, { name: "Camp", siteType: "camp", state: "AS", district: DISTRICT, lat: 27.5, lng: 94.5, people: 10 })
    const site = toRec(await chain.pub.getEntity(siteKey))
    const { createdEntities } = await postNeed(camp, chain.pub, { site, item: "clothes", qty: 300, urgency: 3 })
    const need = toRec(await chain.pub.getEntity(createdEntities[0]!))
    const { createdEntities: pledged } = await pledgeTo(wallets.ngo_majuli, chain.pub, { need, qty: 120, etaUnix: Math.floor(Date.now() / 1000) + 3600 })
    const pledge = toRec(await chain.pub.getEntity(pledged[0]!))
    for (let i = 0; i < 1000; i++) await raw({ app, kind: str("note"), need: key(need.key) } as never)
    await recordReceipt(camp, chain.pub, { pledge, need })

    const view = await loadNeed(chain.pub, need.key)
    expect(view.state).toBe("live")
    if (view.state !== "live") return
    expect(view.truncated).toBe(true)
    expect([view.gap.qty, view.gap.pledged]).toEqual([180n, 0n])

    const mine = await loadCamp(chain.pub, camp.account.address)
    expect(mine.truncated).toBe(true)
    expect(mine.needs[0]?.gap.pledged).toBe(0n)
  })
})
