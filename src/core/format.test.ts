import { describe, expect, it } from "vitest"
import { formatDuration, renderTable, shortHex } from "./format"

describe("formatDuration", () => {
  it("says expired for zero or negative time", () => {
    expect(formatDuration(0)).toBe("expired")
    expect(formatDuration(-5)).toBe("expired")
  })

  it("shows the two most useful units", () => {
    expect(formatDuration(59)).toBe("59s")
    expect(formatDuration(200)).toBe("3m 20s")
    expect(formatDuration(3 * 3600 + 12 * 60 + 40)).toBe("3h 12m")
    expect(formatDuration(25 * 3600)).toBe("1d 1h")
  })
})

describe("shortHex", () => {
  it("keeps both ends of an address or key", () => {
    expect(shortHex("0xAe0a347474596E103458cEc04AE7075fe706F46a")).toBe("0xAe0a…F46a")
  })

  it("leaves short values alone", () => {
    expect(shortHex("0x1234")).toBe("0x1234")
  })
})

describe("renderTable", () => {
  it("aligns columns to the widest cell", () => {
    expect(renderTable(["Item", "Gap"], [["water", "2000"], ["ors", "5"]])).toBe(
      ["Item   Gap ", "-----  ----", "water  2000", "ors    5   "].join("\n"),
    )
  })
})
