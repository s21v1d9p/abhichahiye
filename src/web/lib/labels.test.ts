import { describe, expect, it } from "vitest"
import { ITEMS } from "../../core/schema"
import { ITEM_LABELS, urgencyLabel } from "./labels"
import { needUrl, shareMessage, whatsappLink } from "./share"

describe("labels", () => {
  it("names every item in English, Hindi and Assamese", () => {
    for (const item of ITEMS) {
      const l = ITEM_LABELS[item]
      expect(l.en.length).toBeGreaterThan(0)
      expect(l.hi.length).toBeGreaterThan(0)
      expect(l.as.length).toBeGreaterThan(0)
    }
  })

  it("describes the three urgency levels with their lifetimes", () => {
    expect(urgencyLabel(3).en).toMatch(/6 h/)
    expect(urgencyLabel(2).en).toMatch(/12 h/)
    expect(urgencyLabel(1).en).toMatch(/24 h/)
  })
})

describe("share message", () => {
  const base = {
    item: "clothes" as const,
    camp: "Silapathar relief camp (demo)",
    district: "dhemaji",
    qty: 300n,
    pledged: 120n,
    gap: 180n,
    secondsLeft: 3 * 3600 + 1800,
    url: "https://abhichahiye.vercel.app/n/0xabc",
  }

  it("says what is needed, how much, until when, and where to check before forwarding", () => {
    const text = shareMessage(base)
    expect(text).toContain("Clothes")
    expect(text).toContain("Silapathar relief camp (demo)")
    expect(text).toContain("180")
    expect(text).toContain("3h 30m")
    expect(text).toContain(base.url)
    expect(text.toLowerCase()).toContain("still live")
  })

  it("builds a WhatsApp link that url-encodes the whole message", () => {
    expect(whatsappLink("a b & c")).toBe("https://wa.me/?text=a%20b%20%26%20c")
  })

  it("links to the need page by key", () => {
    expect(needUrl("0xabc", "https://example.org")).toBe("https://example.org/n/0xabc")
  })
})
