import { afterEach, describe, expect, it, vi } from "vitest"
import { ArkivQuotaError, arkivFetch, PUBLIC_HTTP } from "./arkiv"

const ok = () => new Response('{"jsonrpc":"2.0","id":1,"result":"0x1"}', { status: 200 })
const limited = (retryAfter: number, error = "ANON_COST_LIMITED") =>
  new Response(JSON.stringify({ error, message: "unauthenticated query budget exhausted" }), { status: 429, headers: { "retry-after": String(retryAfter) } })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function stub(...responses: Response[]) {
  const calls: string[] = []
  const queue = [...responses]
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return queue.shift() ?? ok()
  }))
  return calls
}

const call = (f: typeof fetch) => f(PUBLIC_HTTP, { method: "POST", body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}' })

describe("arkivFetch", () => {
  it("uses the public endpoint while it answers", async () => {
    const calls = stub(ok())
    const res = await call(arkivFetch("ark_live_test"))
    expect(res.status).toBe(200)
    expect(calls).toEqual([PUBLIC_HTTP])
  })

  it("switches to the access key when the anonymous budget runs out, and stays on it until the budget resets", async () => {
    vi.useFakeTimers()
    const calls = stub(limited(2046), ok(), ok(), ok())
    const f = arkivFetch("ark_live_test")
    expect((await call(f)).status).toBe(200)
    expect((await call(f)).status).toBe(200)
    expect(calls).toEqual([PUBLIC_HTTP, `${PUBLIC_HTTP}/ark_live_test`, `${PUBLIC_HTTP}/ark_live_test`])
    vi.advanceTimersByTime(2047 * 1000)
    await call(f)
    expect(calls.at(-1)).toBe(PUBLIC_HTTP)
  })

  it("fails at once with a clear error instead of waiting half an hour when there is no key", async () => {
    stub(limited(2046))
    const error = await call(arkivFetch()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ArkivQuotaError)
    expect((error as ArkivQuotaError).retryAfterSeconds).toBe(2046)
    expect((error as Error).message).toMatch(/34 min/)
  })

  it("leaves a short rate-limit pause to the normal retry", async () => {
    stub(limited(3, "RATE_LIMITED"))
    expect((await call(arkivFetch())).status).toBe(429)
  })
})
