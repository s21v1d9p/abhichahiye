import { describe, expect, it, vi } from "vitest"
import type { Hex } from "viem"
import { createDrip, type DripDeps } from "./drip"

const DRIP = "0x00000000000000000000000000000000000000d1" as Hex
const ALICE = "0x1111111111111111111111111111111111111111"
const AMOUNT = 10n ** 16n

function deps(overrides: Partial<DripDeps> = {}, balances: Record<string, bigint> = {}) {
  const sent: Array<{ to: Hex; value: bigint }> = []
  let clock = 1_000_000
  const base: DripDeps = {
    dripAddress: DRIP,
    amount: AMOUNT,
    skipAbove: AMOUNT / 2n,
    balanceOf: async (address) => balances[address.toLowerCase()] ?? (address === DRIP ? 10n ** 19n : 0n),
    send: async (to, value) => {
      sent.push({ to, value })
      return `0x${sent.length.toString(16).padStart(64, "0")}` as Hex
    },
    now: () => clock,
    ...overrides,
  }
  return { deps: base, sent, advance: (ms: number) => (clock += ms) }
}

describe("drip", () => {
  it("rejects a request without a valid address", async () => {
    const { deps: d, sent } = deps()
    const drip = createDrip(d)
    expect((await drip(null, "ip")).status).toBe(400)
    expect((await drip({ address: "0x123" }, "ip")).status).toBe(400)
    expect((await drip({ address: 42 }, "ip")).status).toBe(400)
    expect(sent).toEqual([])
  })

  it("sends the configured amount to a new wallet and returns the transaction", async () => {
    const { deps: d, sent } = deps()
    const reply = await createDrip(d)({ address: ALICE }, "ip")
    expect(reply.status).toBe(200)
    expect(reply.body.txHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(sent).toEqual([{ to: ALICE, value: AMOUNT }])
  })

  it("does not top up a wallet that still has enough", async () => {
    const { deps: d, sent } = deps({}, { [ALICE]: AMOUNT })
    const reply = await createDrip(d)({ address: ALICE }, "ip")
    expect(reply).toEqual({ status: 200, body: { skipped: "already funded" } })
    expect(sent).toEqual([])
  })

  it("limits each network to five top-ups per ten minutes", async () => {
    const { deps: d, sent, advance } = deps()
    const drip = createDrip(d)
    const wallet = (i: number) => `0x${(i + 1).toString(16).padStart(40, "0")}`
    for (let i = 0; i < 5; i++) expect((await drip({ address: wallet(i) }, "1.2.3.4")).status).toBe(200)
    expect((await drip({ address: wallet(5) }, "1.2.3.4")).status).toBe(429)
    expect((await drip({ address: wallet(6) }, "5.6.7.8")).status).toBe(200)
    advance(10 * 60_000)
    expect((await drip({ address: wallet(7) }, "1.2.3.4")).status).toBe(200)
    expect(sent).toHaveLength(7)
  })

  it("says so when the drip wallet itself is nearly empty", async () => {
    const { deps: d, sent } = deps({}, { [DRIP]: AMOUNT })
    const reply = await createDrip(d)({ address: ALICE }, "ip")
    expect(reply.status).toBe(503)
    expect(reply.body.error).toMatch(/faucet/)
    expect(sent).toEqual([])
  })

  it("never sends two transactions at once, so they cannot race for the same nonce", async () => {
    let inFlight = 0
    let most = 0
    const send = vi.fn(async () => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return `0x${"a".repeat(64)}` as Hex
    })
    const { deps: d } = deps({ send })
    const drip = createDrip(d)
    const wallets = [1, 2, 3].map((i) => `0x${i.toString(16).padStart(40, "0")}`)
    const replies = await Promise.all(wallets.map((address, i) => drip({ address }, `ip${i}`)))
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200])
    expect(send).toHaveBeenCalledTimes(3)
    expect(most).toBe(1)
  })

  it("keeps serving after a send fails", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("nonce too low")).mockResolvedValue(`0x${"b".repeat(64)}`)
    const { deps: d } = deps({ send })
    const drip = createDrip(d)
    await expect(drip({ address: ALICE }, "ip")).rejects.toThrow(/nonce/)
    expect((await drip({ address: ALICE }, "ip")).status).toBe(200)
  })
})
