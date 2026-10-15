import { describe, expect, it } from "vitest"
import { secondsUntil } from "./chainTime"

const snap = { block: 1000n, fetchedAt: 1_000_000 }

describe("secondsUntil", () => {
  it("counts the blocks left at two seconds each from the moment of the snapshot", () => {
    expect(secondsUntil(1100n, snap, 1_000_000)).toBe(200)
  })

  it("counts down smoothly with the wall clock instead of jumping per block", () => {
    expect(secondsUntil(1100n, snap, 1_000_000 + 1_000)).toBe(199)
    expect(secondsUntil(1100n, snap, 1_000_000 + 61_000)).toBe(139)
  })

  it("never goes negative once the expiry block has passed", () => {
    expect(secondsUntil(1100n, snap, 1_000_000 + 500_000)).toBe(0)
    expect(secondsUntil(900n, snap, 1_000_000)).toBe(0)
  })
})
