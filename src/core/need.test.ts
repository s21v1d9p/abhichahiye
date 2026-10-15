import { ExpirationTime } from "@arkiv-network/sdk"
import { str } from "@arkiv-network/sdk/attr"
import { jsonToPayload } from "@arkiv-network/sdk/utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Hex } from "viem"
import { needAttrs, receiptAttrs, siteAttrs } from "./attrs"
import { createMemChain, type MemChain } from "./memchain"
import { loadNeed } from "./queries"
import { type Rec, toRec } from "./records"
import type { WalletClient } from "./arkiv"
import { createSite, pledgeTo, postNeed, recordReceipt, registerOrg, vouchFor } from "./writes"

let chain: MemChain
let camp: WalletClient
let donor: WalletClient
let stranger: WalletClient
let authority: WalletClient

const json = (o: object) => ({ payload: jsonToPayload(o), contentType: "application/json" as const })
const now = () => Math.floor(Date.now() / 1000)
const place = { state: "AS", district: "Dhemaji", lat: 27.594, lng: 94.723 }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-15T08:00:00Z"))
  chain = createMemChain()
  ;[camp, donor, stranger, authority] = [chain.wallet(), chain.wallet(), chain.wallet(), chain.wallet()]
})

afterEach(() => {
  vi.useRealTimers()
})

async function campWithNeed() {
  await registerOrg(camp, { name: "Silapathar Camp Committee (demo)", orgType: "govt", state: "AS", district: "Dhemaji" })
  const { entityKey: siteKey } = await createSite(camp, { name: "Silapathar camp (demo)", siteType: "camp", people: 400, ...place })
  const site = toRec(await chain.pub.getEntity(siteKey))
  const { createdEntities } = await postNeed(camp, chain.pub, { site, item: "clothes", qty: 300, urgency: 3 })
  const need = toRec(await chain.pub.getEntity(createdEntities[0]!))
  return { site, need }
}

async function pledge(need: Rec, qty = 120) {
  const { createdEntities } = await pledgeTo(donor, chain.pub, { need, qty, etaUnix: now() + 3600 })
  return toRec(await chain.pub.getEntity(createdEntities[0]!))
}

describe("loadNeed", () => {
  it("returns a live need with its gap, its camp, and the organisation that confirmed it", async () => {
    const { need, site } = await campWithNeed()
    await pledge(need)
    const view = await loadNeed(chain.pub, need.key, now())
    expect(view.state).toBe("live")
    if (view.state !== "live") return
    expect([view.gap.qty, view.gap.pledged, view.gap.gap]).toEqual([300n, 120n, 180n])
    expect(view.site.key).toBe(site.key)
    expect(view.orgName).toBe("Silapathar Camp Committee (demo)")
    expect(view.vouched).toBe(false)
  })

  it("says the camp is vouched only for a vouch by an authority the reader trusts", async () => {
    const { need } = await campWithNeed()
    await vouchFor(authority, { org: camp.account.address, district: "Dhemaji" })
    const trusted = await loadNeed(chain.pub, need.key, now(), [authority.account.address])
    const other = await loadNeed(chain.pub, need.key, now(), [stranger.account.address])
    expect(trusted.state === "live" && trusted.vouched).toBe(true)
    expect(other.state === "live" && other.vouched).toBe(false)
  })

  it("ignores a stranger's receipt and honours the camp's own", async () => {
    const { need, site } = await campWithNeed()
    const p = await pledge(need)
    await stranger.createEntity({
      payload: new Uint8Array(),
      contentType: "application/octet-stream",
      attributes: receiptAttrs({ pledge: p.key, need: need.key, site: site.key, district: "Dhemaji", qty: 120, pledger: p.creator }),
      expires: ExpirationTime.fromSeconds(3600),
      flags: { readonly: true },
    })
    const forged = await loadNeed(chain.pub, need.key, now())
    expect(forged.state === "live" && [forged.gap.qty, forged.gap.pledged]).toEqual([300n, 120n])

    await recordReceipt(camp, chain.pub, { pledge: p, need })
    const settled = await loadNeed(chain.pub, need.key, now())
    expect(settled.state === "live" && [settled.gap.qty, settled.gap.pledged, settled.gap.gap]).toEqual([180n, 0n, 180n])
  })

  it("says gone once the need has lapsed, and for keys that never existed or are not keys", async () => {
    const { need } = await campWithNeed()
    chain.advance(BigInt(6 * 3600) / 2n)
    expect((await loadNeed(chain.pub, need.key, now())).state).toBe("gone")
    expect((await loadNeed(chain.pub, `0x${"ab".repeat(32)}` as Hex)).state).toBe("gone")
    expect((await loadNeed(chain.pub, "0x1234" as Hex)).state).toBe("gone")
  })

  it("rejects entities that belong to another app", async () => {
    const { entityKey } = await stranger.createEntity({ ...json({}), attributes: { app: str("someone-else"), kind: str("need") }, expires: ExpirationTime.fromSeconds(600) })
    expect((await loadNeed(chain.pub, entityKey)).state).toBe("foreign")
  })

  it("flags a need whose camp listing has lapsed", async () => {
    const { entityKey: siteKey } = await camp.createEntity({ ...json({}), attributes: siteAttrs({ siteType: "camp", people: 10, ...place }), expires: ExpirationTime.fromSeconds(60) })
    const { entityKey } = await camp.createEntity({
      ...json({}),
      attributes: needAttrs({ site: siteKey, state: "AS", district: "Dhemaji", item: "water", qty: 10, urgency: 3, lat: place.lat, lng: place.lng }),
      expires: ExpirationTime.fromSeconds(3600),
    })
    chain.advance(31n)
    expect((await loadNeed(chain.pub, entityKey)).state).toBe("orphan")
  })

  it("flags a need written by a different wallet than the camp listing's creator", async () => {
    const { site } = await campWithNeed()
    const { entityKey } = await stranger.createEntity({
      ...json({}),
      attributes: needAttrs({ site: site.key, state: "AS", district: "Dhemaji", item: "water", qty: 999, urgency: 3, lat: place.lat, lng: place.lng }),
      expires: ExpirationTime.fromSeconds(3600),
    })
    expect((await loadNeed(chain.pub, entityKey)).state).toBe("forged")
  })
})
