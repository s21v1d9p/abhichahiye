import type { IncomingMessage, ServerResponse } from "node:http"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite"

// In development, /api/* is served by the same handlers Vercel deploys from api/, so the drip is tested for real.
function devApi(): Plugin {
  const handle = async (server: ViteDevServer, req: IncomingMessage, res: ServerResponse) => {
    const name = new URL(req.url ?? "/", "http://localhost").pathname.replace(/^\/api\//, "")
    if (!/^[a-z-]+$/.test(name)) {
      res.statusCode = 404
      return res.end()
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value)
    }
    headers.set("x-forwarded-for", req.socket.remoteAddress ?? "local")
    const request = new Request(new URL(req.url ?? "/", "http://localhost"), {
      method: req.method ?? "GET",
      headers,
      ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
    })
    const mod = (await server.ssrLoadModule(`/api/${name}.ts`)) as { default: { fetch: (r: Request) => Promise<Response> } }
    const response = await mod.default.fetch(request)
    res.statusCode = response.status
    response.headers.forEach((value, key) => res.setHeader(key, value))
    res.end(Buffer.from(await response.arrayBuffer()))
  }
  return {
    name: "abhichahiye-dev-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next()
        handle(server, req, res).catch(next)
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Server-only secrets (DRIP_PK) reach the dev API handlers through process.env; only VITE_* reach the browser.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""))
  return { plugins: [react(), devApi()] }
})
