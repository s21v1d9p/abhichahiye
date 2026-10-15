import { describe, expect, it } from "vitest"
import type { Expression } from "@arkiv-network/sdk/query"
import type { PublicClient } from "./arkiv"
import { boxWhere, fetchAll, loadDistrict, needsInBox, needsWhere, toQueryString } from "./queries"

type Call = { atBlock?: bigint; cursor?: string }

// Behaves like Tiramisu: the head advances between requests, and a cursor only works at the block it was issued for.
function fakeNode(pages: number, perPage = 2) {
  let head = 100n
  const calls: Call[] = []
  const wheres: Expression[][] = []
  const issuedAt = new Map<string, bigint>()
  const entity = (i: number) => ({
    key: `0x${i.toString(16).padStart(64, "0")}`,
    creator: "0xc",
    owner: "0xc",
    expiresAt: 5n,
    attributes: {},
    payload: new Uint8Array(),
  })
  const select = () => {
    const state: Call = {}
    const builder = {
      where: (w: Expression[]) => {
        wheres.push(w)
        return builder
      },
      limit: () => builder,
      createdBy: () => builder,
      ownedBy: () => builder,
      atBlock: (b: bigint) => {
        state.atBlock = b
        return builder
      },
      cursor: (c: string) => {
        state.cursor = c
        return builder
      },
      fetch: async () => {
        calls.push({ ...state })
        head += 1n
        const readAt = state.atBlock ?? head
        let index = 0
        if (state.cursor !== undefined) {
          if (issuedAt.get(state.cursor) !== readAt) {
            throw Object.assign(new Error("cursor belongs to a different query, block or select"), { code: -32005 })
          }
          index = Number(state.cursor.slice(1))
        }
        const cursor = index + 1 < pages ? `c${index + 1}` : undefined
        if (cursor) issuedAt.set(cursor, readAt)
        return {
          entities: Array.from({ length: perPage }, (_, i) => entity(index * perPage + i)),
          blockNumber: readAt,
          cursor,
          hasNextPage: () => cursor !== undefined,
          next: async () => {
            throw new Error("SDK next() re-queries at the head and must not be used")
          },
        }
      },
    }
    return builder
  }
  return { client: { select, getBlockNumber: async () => head } as unknown as PublicClient, calls, wheres }
}

describe("fetchAll pagination", () => {
  it("reads every later page at the block of the first, even as the head advances", async () => {
    const { client, calls } = fakeNode(4)
    const { recs, truncated } = await fetchAll(client, [])
    expect(recs).toHaveLength(8)
    expect(truncated).toBe(false)
    expect(new Set(recs.map((r) => r.key)).size).toBe(8)
    expect(calls[0]).toEqual({})
    expect(calls.slice(1).map((c) => c.atBlock)).toEqual([101n, 101n, 101n])
    expect(calls.slice(1).map((c) => c.cursor)).toEqual(["c1", "c2", "c3"])
  })

  it("honours an explicit block for the whole walk", async () => {
    const { client, calls } = fakeNode(3)
    await fetchAll(client, [], {}, 90n)
    expect(calls.map((c) => c.atBlock)).toEqual([90n, 90n, 90n])
  })

  it("reports truncation instead of silently dropping entities past 1000", async () => {
    const { client } = fakeNode(10, 200)
    const result = await fetchAll(client, [])
    expect(result.recs).toHaveLength(1000)
    expect(result.truncated).toBe(true)
  })

  it("is not truncated when the last page ends exactly on the cap", async () => {
    const { client } = fakeNode(5, 200)
    const result = await fetchAll(client, [])
    expect(result.recs).toHaveLength(1000)
    expect(result.truncated).toBe(false)
  })
})

describe("loadDistrict snapshot", () => {
  it("reads all six queries at one block and reports it", async () => {
    const { client, calls } = fakeNode(1)
    const data = await loadDistrict(client, { district: "Dhemaji" })
    expect(calls).toHaveLength(6)
    expect(calls.every((c) => c.atBlock !== undefined)).toBe(true)
    expect(new Set(calls.map((c) => c.atBlock)).size).toBe(1)
    expect(data.block).toBe(calls[0]!.atBlock)
    expect(data.truncated).toBe(false)
  })

  it("tells the caller when any of the six result sets was cut short", async () => {
    const { client } = fakeNode(10, 200)
    expect((await loadDistrict(client, { district: "Dhemaji" })).truncated).toBe(true)
  })
})

describe("needsInBox", () => {
  it("clamps a zoomed-out viewport instead of throwing", async () => {
    const { client, wheres } = fakeNode(1)
    await needsInBox(client, { south: -85, west: -180, north: 85, east: 200 })
    expect(toQueryString(wheres[0]!)).toBe(
      "app = str('abhichahiye') AND kind = str('need') AND lat_e6 >= u64(0) AND lat_e6 <= u64(85000000) AND lng_e6 >= u64(0) AND lng_e6 <= u64(180000000)",
    )
  })

  it("rejects instead of throwing synchronously on invalid input", async () => {
    const { client } = fakeNode(1)
    await expect(needsInBox(client, { south: Number.NaN, west: 0, north: 1, east: 1 })).rejects.toThrow(RangeError)
  })
})

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
