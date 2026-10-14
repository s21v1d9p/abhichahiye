import { describe, expect, it } from "vitest"
import { fromE6, slug, toE6 } from "./geo"

describe("geo", () => {
  it("round-trips degrees through e6 integers", () => {
    expect(toE6(27.483912)).toBe(27483912n)
    expect(fromE6(toE6(94.578123))).toBeCloseTo(94.578123, 6)
    expect(fromE6(27483912n)).toBeCloseTo(27.483912, 6)
  })

  it("rejects coordinates outside 0..180", () => {
    expect(() => toE6(-1)).toThrow(RangeError)
    expect(() => toE6(181)).toThrow(RangeError)
    expect(() => toE6(Number.NaN)).toThrow(RangeError)
  })

  it("slugs district names for equality queries", () => {
    expect(slug("  North Lakhimpur ")).toBe("north_lakhimpur")
    expect(slug("Dhemaji")).toBe("dhemaji")
  })
})
