import { ExpirationTime } from "@arkiv-network/sdk"
import { key, str, u256, u64 } from "@arkiv-network/sdk/attr"
import { jsonToPayload } from "@arkiv-network/sdk/utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Hex } from "viem"
import type { WalletClient } from "./arkiv"
import { needAttrs, orgAttrs, pledgeAttrs, receiptAttrs, siteAttrs } from "./attrs"
import { loadCamp, loadDirectory, loadPledges } from "./consoles"
import { createMemChain, type MemChain } from "./memchain"
import { byKind, loadDistrict, loadNeed } from "./queries"
import { s, toRec } from "./records"
import { DISTRICT, ROLES, runScenario, type Wallets } from "./scenario"
import { MAX_QTY } from "./schema"
import { isWellFormed } from "./shape"
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
const base = { key: `0x${"1".repeat(64)}` as Hex, creator: `0x${"2".repeat(40)}` as Hex, owner: `0x${"2".repeat(40)}` as Hex, expiresAt: 1n }

describe("toRec", () => {
  it("keeps only a JSON object as the payload", () => {
    for (const text of ["null", "[1,2]", '"text"', "42", "{oops"]) {
      expect(toRec({ ...base, payload: new TextEncoder().encode(text) }).payload).toEqual({})
    }
    expect(toRec({ ...base, payload: new TextEncoder().encode('{"name":"x"}') }).payload).toEqual({ name: "x" })
  })

  // String({ toString: 1 }) throws, and every view prints names with String(payload.name ?? "").
  it("keeps only the string fields of the payload, so every reader can print them", () => {
    const rec = toRec({ ...base, payload: new TextEncoder().encode('{"name":{"toString":1},"note":["x"],"landmark":7,"helpline":"1077"}') })
    expect(rec.payload).toEqual({ helpline: "1077" })
    expect(() => String(rec.payload.name ?? "")).not.toThrow()
  })

  // The command line prints camp names and districts to a terminal, where ESC sequences can move the cursor and
  // overwrite the numbers of other camps. The SDK refuses control characters in str(), but a raw write can store them.
  it("turns control characters into spaces, so a stranger's text cannot steer a terminal", () => {
    const rec = toRec({
      ...base,
      payload: new TextEncoder().encode(JSON.stringify({ name: "Camp\u001b[2J\u001b[1A\r\nX\u009b31m" })),
      attributes: { district: { type: "str", value: "dhe\u001b]0;x\u0007maji" } },
    })
    expect(rec.payload.name).toBe("Camp [2J [1A  X 31m")
    expect(s(rec, "district")).toBe("dhe ]0;x maji")
  })
})

// A reader accepts exactly what our own writers (attrs.ts) can produce. Anything else was not written by AbhiChahiye,
// even when its kind and attribute names say so, and is skipped before any view sees it.
describe("isWellFormed", () => {
  const rec = (attributes: object) => toRec({ ...base, attributes: { app, ...attributes } as never })
  const k = `0x${"a".repeat(64)}` as Hex
  const legit = {
    org: orgAttrs({ orgType: "ngo", state: "as", district: DISTRICT }),
    site: siteAttrs({ siteType: "camp", state: "as", district: DISTRICT, lat: 27.5, lng: 94.5, people: 10 }),
    need: needAttrs({ site: k, state: "as", district: DISTRICT, item: "water", qty: 10, urgency: 3, lat: 27.5, lng: 94.5 }),
    pledge: pledgeAttrs({ need: k, site: k, district: DISTRICT, item: "water", qty: 10, eta: 1_800_000_000 }),
    receipt: receiptAttrs({ pledge: k, need: k, site: k, district: DISTRICT, qty: 10, pledger: `0x${"b".repeat(40)}` }),
  }

  it("accepts everything our writers produce", () => {
    for (const attributes of Object.values(legit)) expect(isWellFormed(rec(attributes))).toBe(true)
  })

  it.each([
    ["org", "org_type", str("__proto__")],
    ["org", "org_type", str("constructor")],
    ["site", "site_type", str("toString")],
    ["site", "lng_e6", u256(10n ** 30n)],
    ["site", "lat_e6", u64(180_000_001n)],
    ["site", "people", u64(0n)],
    ["need", "lng_e6", u256(10n ** 30n)],
    ["need", "lat_e6", u64(2n ** 64n - 1n)],
    ["need", "qty", u64(0n)],
    ["need", "qty", u64(BigInt(MAX_QTY) + 1n)],
    ["need", "urgency", u64(0n)],
    ["need", "urgency", u64(4n)],
    ["pledge", "qty", u64(0n)],
    ["receipt", "qty", u64(0n)],
  ] as const)("skips a %s whose %s is %o", (kind, name, value) => {
    expect(isWellFormed(rec({ ...legit[kind], [name]: value }))).toBe(false)
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

  it("strangers' impossible numbers, object names and prototype-named types never reach a view", async () => {
    await runScenario(chain.pub, wallets)
    const [eve, trent] = [chain.wallet(), chain.wallet()]
    const write = (w: WalletClient, attributes: object, payload = jsonToPayload({ name: "x (demo)" })) =>
      w.createEntity({ payload, contentType: "application/json", attributes: attributes as never, expires: ExpirationTime.fromSeconds(3600) })
    const campOf = async (w: WalletClient) => (await write(w, siteAttrs({ siteType: "camp", state: "as", district: DISTRICT, lat: 27.5, lng: 94.5, people: 10 }))).entityKey
    const needAt = (site: Hex) => needAttrs({ site, state: "as", district: DISTRICT, item: "water", qty: 10, urgency: 3, lat: 27.5, lng: 94.5 })
    const by = (w: WalletClient) => (r: { creator: string }) => r.creator === w.account.address.toLowerCase()

    // Mallory: an authentic need (her own camp) with a longitude that sends Leaflet into an endless loop, and an
    // organisation in this district whose type names a prototype property.
    await write(mallory, { ...needAt(await campOf(mallory)), lng_e6: u256(10n ** 30n) })
    await write(mallory, { ...orgAttrs({ orgType: "ngo", state: "as", district: DISTRICT }), org_type: str("__proto__") })
    // Eve: a valid need, with her organisation registered elsewhere, so the board fetches it by creator.
    await write(eve, needAt(await campOf(eve)))
    await write(eve, { ...orgAttrs({ orgType: "ngo", state: "as", district: "elsewhere" }), org_type: str("constructor") })
    // Trent: a valid organisation whose name is an object that String() cannot convert.
    await write(trent, orgAttrs({ orgType: "ngo", state: "as", district: DISTRICT }), new TextEncoder().encode('{"name":{"toString":1}}'))

    const data = await loadDistrict(chain.pub, { district: DISTRICT })
    expect(data.needs.some(by(mallory))).toBe(false)
    expect(data.needs.some(by(eve))).toBe(true)
    expect(data.orgs.some(by(eve))).toBe(false)
    expect(data.orgs.find(by(trent))?.payload).toEqual({})
    expect(() => data.orgs.map((o) => String(o.payload.name ?? ""))).not.toThrow()

    const { rows } = await loadDirectory(chain.pub, DISTRICT, undefined, [])
    expect(rows.some((row) => by(mallory)(row.org))).toBe(false)
    expect(rows.some((row) => by(trent)(row.org))).toBe(true)
  })
})
