import { describe, expect, it } from "vitest"
import { blocksFor, needsLeaseRenewal, renewalTarget, secondsLeft } from "./expiry"

describe("expiry policy", () => {
  it("converts seconds to 2 s blocks, rounding up", () => {
    expect(blocksFor(6 * 3600)).toBe(10800n)
    expect(blocksFor(3)).toBe(2n)
  })

  it("reports seconds left, never negative", () => {
    expect(secondsLeft(1100n, 1000n)).toBe(200)
    expect(secondsLeft(900n, 1000n)).toBe(0)
  })

  it("renews to ttl from now when that is later than the current expiry", () => {
    expect(renewalTarget(1500n, 1000n, 6 * 3600)).toBe(1000n + 10800n)
  })

  it("never produces a target that is not strictly later (the engine would revert)", () => {
    expect(renewalTarget(50_000n, 1000n, 3600)).toBe(50_001n)
  })

  it("only renews a lease once it has meaningfully aged", () => {
    const ttl = 90 * 86400
    expect(needsLeaseRenewal(1000n + blocksFor(ttl), 1000n, ttl)).toBe(false)
    expect(needsLeaseRenewal(1000n + blocksFor(ttl - 7200), 1000n, ttl)).toBe(true)
  })
})
