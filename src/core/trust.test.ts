import { describe, expect, it } from "vitest"
import { LIFETIME, MAX_QTY } from "./schema"
import type { Rec } from "./records"
import { type Clock, isAuthenticNeed, isWellFormedPledge, settles, trustedOrgs } from "./trust"

const rec = (key: string, creator: string, attrs: Record<string, string | bigint>, expiresAt = 1n): Rec => ({
  key: key as `0x${string}`,
  creator: creator as `0x${string}`,
  owner: creator as `0x${string}`,
  expiresAt,
  attrs,
  payload: {},
})

const CAMP = "0xcamp"
const IMPOSTOR = "0xbad"
const AUTH = "0xauth"
const NGO = "0xngo"
const site = rec("0xs1", CAMP, { kind: "site" })
const sites = new Map([[site.key, site]])

describe("authentic needs", () => {
  it("accepts a need created by the site's creator", () => {
    expect(isAuthenticNeed(rec("0xn1", CAMP, { site: "0xs1" }), sites)).toBe(true)
  })

  it("rejects a need that points at someone else's site", () => {
    expect(isAuthenticNeed(rec("0xn2", IMPOSTOR, { site: "0xs1" }), sites)).toBe(false)
  })

  it("rejects a need whose site is gone", () => {
    expect(isAuthenticNeed(rec("0xn3", CAMP, { site: "0xmissing" }), sites)).toBe(false)
  })
})

describe("settling a pledge", () => {
  const need = rec("0xn1", CAMP, { site: "0xs1" })
  const pledge = rec("0xp1", NGO, { need: "0xn1" })

  it("accepts a receipt written by the wallet that created the need", () => {
    expect(settles(rec("0xr1", CAMP, { pledge: "0xp1" }), pledge, need)).toBe(true)
  })

  it("rejects a receipt from another wallet, even one that created its own site", () => {
    const forged = rec("0xr2", IMPOSTOR, { pledge: "0xp1", site: "0xs9" })
    expect(settles(forged, pledge, need)).toBe(false)
  })

  it("rejects the donor's own receipt", () => {
    expect(settles(rec("0xr3", NGO, { pledge: "0xp1" }), pledge, need)).toBe(false)
  })

  it("rejects a receipt for a different pledge", () => {
    expect(settles(rec("0xr4", CAMP, { pledge: "0xp2" }), pledge, need)).toBe(false)
  })
})

describe("well-formed pledges", () => {
  const clock: Clock = { nowUnix: 1_760_000_000, block: 1000n }
  const honest = (etaOffset: number, qty = 120n) => {
    const eta = clock.nowUnix + etaOffset
    const expiresAt = clock.block + BigInt(Math.ceil((etaOffset + LIFETIME.pledgeGrace) / 2))
    return rec("0xp1", NGO, { qty, eta: BigInt(eta) }, expiresAt)
  }

  it("accepts a pledge that lapses two hours after its ETA", () => {
    expect(isWellFormedPledge(honest(3 * 3600), clock)).toBe(true)
    expect(isWellFormedPledge(honest(LIFETIME.pledgeMaxHorizon), clock)).toBe(true)
  })

  it("rejects an ETA further away than the 48 hour limit allows", () => {
    expect(isWellFormedPledge(honest(LIFETIME.pledgeMaxHorizon + 2 * 3600), clock)).toBe(false)
  })

  it("rejects a pledge that outlives its own ETA, such as a permanent one", () => {
    const squatter = rec("0xp2", NGO, { qty: 120n, eta: BigInt(clock.nowUnix + 3600) }, 2n ** 64n - 1n)
    expect(isWellFormedPledge(squatter, clock)).toBe(false)
  })

  it("tolerates a little clock drift between writer and reader", () => {
    const drifting = honest(3 * 3600)
    expect(isWellFormedPledge({ ...drifting, expiresAt: drifting.expiresAt + 600n }, clock)).toBe(true)
  })

  it("rejects absurd or empty quantities", () => {
    expect(isWellFormedPledge(honest(3600, BigInt(MAX_QTY) + 1n), clock)).toBe(false)
    expect(isWellFormedPledge(honest(3600, 0n), clock)).toBe(false)
    expect(isWellFormedPledge(honest(3600, BigInt(MAX_QTY)), clock)).toBe(true)
  })
})

describe("vouches", () => {
  it("trusts orgs vouched by a trusted authority only", () => {
    const vouches = [rec("0xv1", AUTH, { org: NGO }), rec("0xv2", IMPOSTOR, { org: IMPOSTOR })]
    const trusted = trustedOrgs(vouches, ["0xAUTH" as `0x${string}`])
    expect(trusted.has(NGO as `0x${string}`)).toBe(true)
    expect(trusted.has(IMPOSTOR as `0x${string}`)).toBe(false)
  })
})
