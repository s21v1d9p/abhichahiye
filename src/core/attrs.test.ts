import { describe, expect, it } from "vitest"
import { assertNoPhone, needAttrs, orgAttrs, pledgeAttrs, receiptAttrs } from "./attrs"
import { n, s, toRec } from "./records"
import { MAX_QTY } from "./schema"

const SITE = `0x${"a".repeat(64)}` as const
const NEED = `0x${"b".repeat(64)}` as const

describe("attribute builders", () => {
  it("builds typed need attributes with numeric ranges", () => {
    const a = needAttrs({ site: SITE, state: "AS", district: "Dhemaji", item: "clothes", qty: 300, urgency: 3, lat: 27.48, lng: 94.58 })
    expect(a.app).toEqual({ type: "str", value: "abhichahiye" })
    expect(a.kind).toEqual({ type: "str", value: "need" })
    expect(a.district).toEqual({ type: "str", value: "dhemaji" })
    expect(a.state).toEqual({ type: "str", value: "as" })
    expect(a.qty).toEqual({ type: "u64", value: 300n })
    expect(a.urgency).toEqual({ type: "u64", value: 3n })
    expect(a.lat_e6).toEqual({ type: "u64", value: 27480000n })
    expect(a.site.type).toBe("key")
  })

  it("rejects non-positive quantities and bad urgency", () => {
    expect(() => needAttrs({ site: SITE, state: "AS", district: "d", item: "ors", qty: 0, urgency: 2, lat: 27, lng: 94 })).toThrow(RangeError)
    expect(() => needAttrs({ site: SITE, state: "AS", district: "d", item: "ors", qty: 1.5, urgency: 2, lat: 27, lng: 94 })).toThrow(RangeError)
    expect(() => needAttrs({ site: SITE, state: "AS", district: "d", item: "ors", qty: 5, urgency: 4 as 3, lat: 27, lng: 94 })).toThrow(RangeError)
  })

  it("caps quantities at a sane maximum, so no entity can carry an absurd number", () => {
    const need = (qty: number) => needAttrs({ site: SITE, state: "AS", district: "d", item: "ors", qty, urgency: 2, lat: 27, lng: 94 })
    expect(() => need(MAX_QTY)).not.toThrow()
    expect(() => need(MAX_QTY + 1)).toThrow(/at most/)
    expect(() => pledgeAttrs({ need: NEED, site: SITE, district: "d", item: "ors", qty: MAX_QTY + 1, eta: 1_760_000_000 })).toThrow(RangeError)
    expect(() => receiptAttrs({ pledge: NEED, need: NEED, site: SITE, district: "d", qty: MAX_QTY + 1, pledger: "0x1111111111111111111111111111111111111111" })).toThrow(RangeError)
  })

  it("links pledges and receipts by entity key", () => {
    const p = pledgeAttrs({ need: NEED, site: SITE, district: "Dhemaji", item: "clothes", qty: 100, eta: 1_760_000_000 })
    expect(p.need).toEqual({ type: "key", value: NEED })
    expect(p.eta).toEqual({ type: "u64", value: 1_760_000_000n })
    const r = receiptAttrs({ pledge: NEED, need: NEED, site: SITE, district: "Dhemaji", qty: 100, pledger: "0x1111111111111111111111111111111111111111" })
    expect(r.pledger.type).toBe("addr")
    expect(r.district).toEqual({ type: "str", value: "dhemaji" })
  })

  it("normalises org district names", () => {
    expect(orgAttrs({ orgType: "ngo", state: "AS", district: "North Lakhimpur" }).district.value).toBe("north_lakhimpur")
  })

  it("blocks Indian mobile numbers in free text", () => {
    expect(() => assertNoPhone("call 9876543210 now")).toThrow()
    expect(() => assertNoPhone("+91 98765 43210")).toThrow()
    expect(() => assertNoPhone("300 sets of clothes, sizes S-XL")).not.toThrow()
    expect(() => assertNoPhone("need 2000 litres by 18:00")).not.toThrow()
  })
})

describe("toRec", () => {
  it("normalises an SDK entity into a plain record", () => {
    const r = toRec({
      key: NEED,
      creator: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      owner: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      expiresAt: 123n,
      attributes: {
        qty: { type: "u64", value: 5n },
        item: { type: "str", value: "ors" },
        site: { type: "key", value: `0x${"A".repeat(64)}` },
      },
      payload: new TextEncoder().encode(JSON.stringify({ note: "hi" })),
    })
    expect(r.creator).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
    expect(n(r, "qty")).toBe(5n)
    expect(s(r, "item")).toBe("ors")
    expect(s(r, "site")).toBe(`0x${"a".repeat(64)}`)
    expect(r.payload).toEqual({ note: "hi" })
  })

  it("tolerates an empty or non-JSON payload", () => {
    const base = { key: NEED, creator: SITE.slice(0, 42) as `0x${string}`, owner: SITE.slice(0, 42) as `0x${string}`, expiresAt: 1n }
    expect(toRec({ ...base, payload: new Uint8Array() }).payload).toEqual({})
    expect(toRec({ ...base, payload: new TextEncoder().encode("not json") }).payload).toEqual({})
  })

  it("refuses entities queried without the fields trust depends on", () => {
    expect(() => toRec({ key: NEED, expiresAt: 1n })).toThrow(/creator/)
  })
})
