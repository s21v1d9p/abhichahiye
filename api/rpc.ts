import { PUBLIC_HTTP } from "../src/core/arkiv"
import { createRpcProxy } from "../src/server/rpcProxy"

// POST /api/rpc: Arkiv queries with the project's access key added on the server. Browsers only come here after the
// public endpoint has answered 429 (its anonymous query budget is spent); see src/core/arkiv.ts.
const key = process.env.ARKIV_KEY
const proxy = key
  ? createRpcProxy({ forward: (body) => fetch(`${PUBLIC_HTTP}/${key}`, { method: "POST", headers: { "content-type": "application/json" }, body }) })
  : undefined

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405, headers: { allow: "POST" } })
    if (!proxy) return Response.json({ error: "No Arkiv access key is configured on this deployment." }, { status: 503 })
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    try {
      return await proxy(await request.text(), ip)
    } catch (error) {
      console.error("rpc proxy failed", error)
      return Response.json({ error: "Could not reach Arkiv just now." }, { status: 502 })
    }
  },
}
