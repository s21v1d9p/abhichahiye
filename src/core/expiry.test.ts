import { describe, expect, it } from "vitest"
import { assertPledgeEta, blocksFor, needsLeaseRenewal, renewalTarget, secondsLeft } from "./expiry"
import { LIFETIME } from "./schema"

describe("expiry policy", () => {
  it("converts seconds to 2 s blocks, rounding up", () => {
    expect(blocksFor(6 * 3600)).toBe(10800n)
    expect(blocksFor(3)).toBe(2n)
  })

  it("reports seconds left, never negative", () => {
    expect(secondsLeft(1100n, 1000n)).toBe(200)
    expect(secondsLeft(900n, 1000n)).toBe(0)
  })

  it("renews to a full lifetime from now when that is later than the current expiry", () => {
    expect(renewalTarget(1500n, 1000n, 6 * 3600)).toBe(1000n + 10800n)
  })

  it("always asks for a strictly later block, so a renewal is a real extension", () => {
    expect(renewalTarget(50_000n, 1000n, 3600)).toBe(50_001n)
  })

  it("only renews a lease once it has meaningfully aged", () => {
    const lifetime = 90 * 86400
    expect(needsLeaseRenewal(1000n + blocksFor(lifetime), 1000n, lifetime)).toBe(false)
    expect(needsLeaseRenewal(1000n + blocksFor(lifetime - 7200), 1000n, lifetime)).toBe(true)
  })
})

describe("pledge ETA rule", () => {
  const now = 1_760_000_000

  it("accepts an ETA in the future within the horizon", () => {
    expect(() => assertPledgeEta(now + 3600, now)).not.toThrow()
    expect(() => assertPledgeEta(now + LIFETIME.pledgeMaxHorizon, now)).not.toThrow()
  })

  it("rejects an ETA that is not in the future", () => {
    expect(() => assertPledgeEta(now, now)).toThrow(RangeError)
    expect(() => assertPledgeEta(now - 60, now)).toThrow(RangeError)
  })

  it("rejects an ETA beyond the horizon, which would hide a gap behind a ghost pledge", () => {
    expect(() => assertPledgeEta(now + LIFETIME.pledgeMaxHorizon + 1, now)).toThrow(/within 48 hours/)
  })

  it("rejects a fractional or non-finite ETA", () => {
    expect(() => assertPledgeEta(now + 10.5, now)).toThrow(RangeError)
    expect(() => assertPledgeEta(Number.NaN, now)).toThrow(RangeError)
  })
})
