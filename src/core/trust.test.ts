import { describe, expect, it } from "vitest"
import type { Rec } from "./records"
import { isAuthenticNeed, isValidReceipt, trustedOrgs } from "./trust"

const rec = (key: string, creator: string, attrs: Record<string, string | bigint>): Rec => ({
  key: key as `0x${string}`,
  creator: creator as `0x${string}`,
  owner: creator as `0x${string}`,
  expiresAt: 1n,
  attrs,
  payload: {},
})

const CAMP = "0xcamp"
const IMPOSTOR = "0xbad"
const AUTH = "0xauth"
const NGO = "0xngo"
const site = rec("0xs1", CAMP, { kind: "site" })
const sites = new Map([[site.key, site]])

describe("trust", () => {
  it("accepts a need created by the site's creator", () => {
    expect(isAuthenticNeed(rec("0xn1", CAMP, { site: "0xs1" }), sites)).toBe(true)
  })

  it("rejects a need that points at someone else's site", () => {
    expect(isAuthenticNeed(rec("0xn2", IMPOSTOR, { site: "0xs1" }), sites)).toBe(false)
  })

  it("rejects a need whose site is gone", () => {
    expect(isAuthenticNeed(rec("0xn3", CAMP, { site: "0xmissing" }), sites)).toBe(false)
  })

  it("counts receipts only from the camp itself", () => {
    expect(isValidReceipt(rec("0xr1", CAMP, { site: "0xs1" }), sites)).toBe(true)
    expect(isValidReceipt(rec("0xr2", NGO, { site: "0xs1" }), sites)).toBe(false)
  })

  it("trusts orgs vouched by a trusted authority only", () => {
    const vouches = [rec("0xv1", AUTH, { org: NGO }), rec("0xv2", IMPOSTOR, { org: IMPOSTOR })]
    const trusted = trustedOrgs(vouches, ["0xAUTH" as `0x${string}`])
    expect(trusted.has(NGO as `0x${string}`)).toBe(true)
    expect(trusted.has(IMPOSTOR as `0x${string}`)).toBe(false)
  })
})
