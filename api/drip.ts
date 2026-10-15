import { dripFromEnv } from "../src/server/drip"

// POST /api/drip {"address": "0x…"}: a little test GLM for a new browser wallet (Tiramisu testnet only).
const drip = dripFromEnv(process.env)

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405, headers: { allow: "POST" } })
    if (!drip) return Response.json({ error: "The test-GLM drip is not configured on this deployment." }, { status: 503 })
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const body: unknown = await request.json().catch(() => null)
    try {
      const reply = await drip(body, ip)
      return Response.json(reply.body, { status: reply.status })
    } catch (error) {
      console.error("drip failed", error)
      return Response.json({ error: "Could not send test GLM just now. Try again in a moment." }, { status: 502 })
    }
  },
}
