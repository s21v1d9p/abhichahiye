import { describe, expect, it } from "vitest"
import { boxWhere, needsWhere, toQueryString } from "./queries"

describe("query predicates", () => {
  it("builds the district gap-board query", () => {
    expect(toQueryString(needsWhere({ district: "Dhemaji" }))).toBe(
      "app = str('abhichahiye') AND kind = str('need') AND district = str('dhemaji') AND urgency >= u64(1)",
    )
  })

  it("slugs the district and adds urgency and item filters", () => {
    expect(toQueryString(needsWhere({ district: " North Lakhimpur ", minUrgency: 2, item: "water" }))).toBe(
      "app = str('abhichahiye') AND kind = str('need') AND district = str('north_lakhimpur') AND urgency >= u64(2) AND item = str('water')",
    )
  })

  it("builds the map-viewport query with numeric ranges on e6 integers", () => {
    expect(toQueryString(boxWhere({ south: 27, west: 94, north: 28, east: 95.5 }))).toBe(
      "app = str('abhichahiye') AND kind = str('need') AND lat_e6 >= u64(27000000) AND lat_e6 <= u64(28000000) AND lng_e6 >= u64(94000000) AND lng_e6 <= u64(95500000)",
    )
  })

  it("rejects a viewport outside the supported coordinate range", () => {
    expect(() => boxWhere({ south: -1, west: 94, north: 28, east: 95 })).toThrow(RangeError)
  })
})
