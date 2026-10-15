// The browser reads Arkiv directly. Only when the public endpoint's anonymous budget runs out does it retry here, and
// this adds the project's access key on the server, as Arkiv's SDK docs advise, so the key never reaches a browser.
// It forwards Arkiv queries and nothing else: the key cannot be used to send transactions or other calls.

const ALLOWED = new Set(["arkiv_query"])
const MAX_BODY = 16_384
const MAX_CALLS = 10
const WINDOW_MS = 10 * 60_000
const PER_WINDOW = 120
const MAX_TRACKED = 10_000

export type RpcProxyDeps = { forward: (body: string) => Promise<Response>; now?: () => number }

const reply = (status: number, error: string) =>
  Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32600, message: error } },
    { status, ...(status === 429 ? { headers: { "retry-after": String(WINDOW_MS / 1000) } } : {}) },
  )

export function createRpcProxy(deps: RpcProxyDeps) {
  const now = deps.now ?? Date.now
  const recent = new Map<string, number[]>()

  return async function proxy(body: string, ip: string): Promise<Response> {
    if (body.length > MAX_BODY) return reply(413, "Request too large")
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return reply(400, "Send a JSON-RPC request")
    }
    const calls = Array.isArray(parsed) ? parsed : [parsed]
    if (calls.length === 0 || calls.length > MAX_CALLS) return reply(400, "Send one to ten JSON-RPC calls")
    if (!calls.every((c) => typeof c === "object" && c !== null && ALLOWED.has((c as { method?: unknown }).method as string))) {
      return reply(403, "Only arkiv_query is forwarded")
    }

    const at = now()
    const hits = (recent.get(ip) ?? []).filter((t) => at - t < WINDOW_MS)
    if (hits.length >= PER_WINDOW) return reply(429, "Too many queries from this network; try again in a few minutes")
    if (recent.size > MAX_TRACKED) recent.clear()
    recent.set(ip, [...hits, at])

    const upstream = await deps.forward(body)
    const headers = new Headers({ "content-type": "application/json" })
    const retryAfter = upstream.headers.get("retry-after")
    if (retryAfter) headers.set("retry-after", retryAfter)
    return new Response(await upstream.text(), { status: upstream.status, headers })
  }
}
