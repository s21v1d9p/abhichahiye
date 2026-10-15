import { describe, expect, it, vi } from "vitest"
import { createRpcProxy } from "./rpcProxy"

const query = (id = 1) => ({ jsonrpc: "2.0", id, method: "arkiv_query", params: ["app = str('abhichahiye')", { limit: "0x1" }] })

function setup(upstream: Response = Response.json({ jsonrpc: "2.0", id: 1, result: { data: [] } })) {
  let clock = 1_000_000
  const forward = vi.fn(async (_body: string) => upstream.clone())
  const proxy = createRpcProxy({ forward, now: () => clock })
  return { proxy, forward, advance: (ms: number) => (clock += ms) }
}

describe("rpc proxy", () => {
  it("forwards a query unchanged and returns the node's answer", async () => {
    const { proxy, forward } = setup()
    const body = JSON.stringify(query())
    const res = await proxy(body, "ip")
    expect(res.status).toBe(200)
    expect(forward).toHaveBeenCalledWith(body)
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { data: [] } })
  })

  it("refuses everything that is not an Arkiv query, so the key cannot be used to send transactions", async () => {
    const { proxy, forward } = setup()
    for (const method of ["eth_sendRawTransaction", "eth_call", "eth_getBalance", "arkiv_getBlockTiming"]) {
      expect((await proxy(JSON.stringify({ ...query(), method }), "ip")).status).toBe(403)
    }
    expect((await proxy(JSON.stringify([query(1), { ...query(2), method: "eth_call" }]), "ip")).status).toBe(403)
    expect(forward).not.toHaveBeenCalled()
  })

  it("rejects malformed and oversized bodies", async () => {
    const { proxy, forward } = setup()
    expect((await proxy("not json", "ip")).status).toBe(400)
    expect((await proxy("[]", "ip")).status).toBe(400)
    expect((await proxy(JSON.stringify({ ...query(), params: ["x".repeat(20_000)] }), "ip")).status).toBe(413)
    expect(forward).not.toHaveBeenCalled()
  })

  it("limits each network address, then lets it through again after the window", async () => {
    const { proxy, advance } = setup()
    const body = JSON.stringify(query())
    for (let i = 0; i < 120; i++) expect((await proxy(body, "1.2.3.4")).status).toBe(200)
    expect((await proxy(body, "1.2.3.4")).status).toBe(429)
    expect((await proxy(body, "5.6.7.8")).status).toBe(200)
    advance(10 * 60_000)
    expect((await proxy(body, "1.2.3.4")).status).toBe(200)
  })

  it("passes the node's own rate limit and Retry-After through", async () => {
    const limited = new Response('{"error":"rate limited"}', { status: 429, headers: { "retry-after": "40" } })
    const { proxy } = setup(limited)
    const res = await proxy(JSON.stringify(query()), "ip")
    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("40")
  })
})
