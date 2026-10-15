import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
import { describe, expect, it } from "vitest"

// Vercel runs every file under api/ as native Node ESM, one transpiled file at a time. Node does not guess file
// extensions, so an extensionless relative import works in Vite and Vitest but crashes the deployed function.
describe("server import graph", () => {
  it("uses explicit .js extensions on every relative import reachable from api/", () => {
    const relative = /(?:^|\n)\s*(?:import|export)(?!\s+type\b)[^"']*?from\s*["'](\.{1,2}\/[^"']+)["']/g
    const queue = readdirSync("api")
      .filter((f) => f.endsWith(".ts"))
      .map((f) => join("api", f))
    const seen = new Set<string>()
    const offenders: string[] = []
    while (queue.length > 0) {
      const file = queue.shift() as string
      if (seen.has(file)) continue
      seen.add(file)
      for (const [, spec] of readFileSync(file, "utf8").matchAll(relative)) {
        if (!spec?.endsWith(".js")) offenders.push(`${file}: ${spec}`)
        const target = normalize(join(dirname(file), (spec ?? "").replace(/\.js$/, ".ts")))
        if (existsSync(target)) queue.push(target)
      }
    }
    expect(offenders).toEqual([])
    expect(seen.size).toBeGreaterThan(2)
  })
})
