// Reproduces every issue in arkiv/friction.md against the live Tiramisu node.
// No funds and no secrets: writes are only simulated with eth_call from a throwaway key.
// Exit code 1 means at least one issue no longer reproduces (it may have been fixed upstream).
import { readFileSync } from "node:fs"
import { createWalletClient } from "@arkiv-network/sdk"
import { str, u64 } from "@arkiv-network/sdk/attr"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { type Expression, exists, gte, hasType, ne, startsWith } from "@arkiv-network/sdk/query"
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils"
import { custom, http } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { makePublicClient, PUBLIC_HTTP } from "../src/core/arkiv"

const client = makePublicClient(process.env.VITE_ARKIV_KEY)
const upstream = http()({ chain: tiramisu }).request
const outcomes: boolean[] = []

const record = (id: string, reproduced: boolean, detail: string) => {
  outcomes.push(reproduced)
  console.log(`${reproduced ? "REPRODUCED    " : "NOT REPRODUCED"}  ${id}  ${detail}`)
}
const firstLine = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e))
const chainOf = (e: unknown): Error[] => {
  const out: Error[] = []
  for (let cur: unknown = e; cur instanceof Error && out.length < 12; cur = (cur as { cause?: unknown }).cause) out.push(cur)
  return out
}
const revertSelector = (e: unknown) =>
  chainOf(e)
    .map((c) => (c as { data?: unknown }).data)
    .find((d): d is string => typeof d === "string" && /^0x[0-9a-f]{8}/i.test(d))
    ?.slice(0, 10)

class Simulated extends Error {}

// A wallet whose gas estimate becomes an eth_call (optionally as another address) and whose send is never made.
function simulatingWallet(from?: () => string | undefined) {
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      if (method === "eth_estimateGas") {
        const [tx, block] = params as [Record<string, unknown>, unknown]
        const { gasPrice: _a, maxFeePerGas: _b, maxPriorityFeePerGas: _c, gas: _d, ...call } = tx
        const sender = from?.()
        if (sender) call.from = sender
        await upstream({ method: "eth_call", params: [call, block ?? "latest"] } as never)
        return "0x2dc6c0"
      }
      if (method === "eth_sendRawTransaction") throw new Simulated("accepted by eth_call")
      return upstream({ method, params } as never)
    },
  })
  return createWalletClient({ chain: tiramisu, transport, account: privateKeyToAccount(generatePrivateKey()) })
}

const { currentBlock } = await client.getBlockTiming()
console.log(`Tiramisu block ${currentBlock}, SDK ${JSON.parse(readFileSync("node_modules/@arkiv-network/sdk/package.json", "utf8")).version}\n`)

// A live entity from any app, with a far-off expiry, to anchor the checks that need existing data.
const anchorPage = await client
  .select({ key: true, owner: true, createdAt: true, expiresAt: true })
  .where(gte("$expiresAt", u64(currentBlock + 50_000n)))
  .limit(1)
  .fetch()
const anchor = anchorPage.entities[0]
if (!anchor) throw new Error("no long-lived entity found on chain to anchor the checks")

// F1: $createdAt range filter. The SDK refuses it, the node supports it.
{
  let refusal = ""
  try {
    gte("$createdAt", u64(anchor.createdAt))
  } catch (e) {
    refusal = `${(e as Error).constructor.name}`
  }
  const rawCount = async (q: string) => (await client.query(q, { select: { key: true }, limit: 200 })).entities.length
  const exact = await rawCount(`$createdAt >= u64(${anchor.createdAt}) AND $createdAt <= u64(${anchor.createdAt})`)
  const future = await rawCount(`$createdAt >= u64(${anchor.createdAt + 100_000_000n})`)
  record(
    "F1 $createdAt filter",
    refusal === "InvalidPredicateError" && exact > 0 && future === 0,
    `SDK gte("$createdAt") -> ${refusal || "accepted"}; raw query: ${exact} rows at block ${anchor.createdAt}, ${future} rows in the far future`,
  )
}

// F2: operators the SDK exports but the node rejects.
{
  const attempt = async (label: string, build: () => Expression) => {
    try {
      await client.select({ key: true }).where(gte("$expiresAt", u64(currentBlock)), build()).limit(1).fetch()
      return `${label}: accepted`
    } catch (e) {
      const q = e as { code?: number }
      return `${label}: ${q.code ?? firstLine(e)}`
    }
  }
  const results = [
    await attempt("ne", () => ne("app", "zzz")),
    await attempt("exists", () => exists("app")),
    await attempt("hasType", () => hasType("app", "str")),
  ]
  let controlOk = true
  try {
    await client.select({ key: true }).where(startsWith("app", "a")).limit(1).fetch()
  } catch {
    controlOk = false
  }
  record(
    "F2 unsupported operators",
    results.every((r) => r.endsWith(": -32002")) && controlOk,
    `${results.join(", ")} (startsWith control works: ${controlOk})`,
  )
}

// F3: an unfunded wallet gets a misleading error.
{
  const w = createWalletClient({ chain: tiramisu, transport: http(), account: privateKeyToAccount(generatePrivateKey()) })
  try {
    await w.createEntity({
      payload: jsonToPayload({ probe: true }),
      contentType: "application/json",
      expires: ExpirationTime.fromMinutes(10),
      attributes: { app: str("friction-repro") },
    })
    record("F3 unfunded wallet error", false, "write unexpectedly succeeded")
  } catch (e) {
    const top = firstLine(e)
    const root = chainOf(e).some((c) => /gas required exceeds: 0/.test(c.message))
    record("F3 unfunded wallet error", root && /without revert data/.test(top), `top-level: "${top}", real cause in nested chain: "gas required exceeds: 0"`)
  }
}

// F4: SDK accepts an uppercase attribute name, the engine reverts it.
{
  const w = simulatingWallet()
  try {
    await w.createEntity({
      payload: jsonToPayload({}),
      contentType: "application/json",
      expires: ExpirationTime.fromMinutes(10),
      attributes: { Foo: str("x") },
    })
    record("F4 uppercase attribute name", false, "engine accepted it")
  } catch (e) {
    const sel = revertSelector(e)
    record("F4 uppercase attribute name", sel === "0x276f7798", `SDK accepted the name; engine revert selector ${sel} (Ident32InvalidByte)`)
  }
}

// F5: extending to exactly the current expiry is accepted; earlier is rejected.
{
  const w = simulatingWallet(() => anchor.owner)
  const probe = async (target: bigint) => {
    try {
      await w.extendEntity({ entityKey: anchor.key, expires: ExpirationTime.atBlock(target) })
      return "write sent"
    } catch (e) {
      if (chainOf(e).some((c) => c instanceof Simulated)) return "accepted"
      return `reverted ${revertSelector(e)}`
    }
  }
  const same = await probe(anchor.expiresAt)
  const earlier = await probe(anchor.expiresAt - 1n)
  const later = await probe(anchor.expiresAt + 1n)
  record(
    "F5 extension to equal expiry",
    same === "accepted" && later === "accepted" && earlier === "reverted 0x33268a0d",
    `current expiry ${anchor.expiresAt}: equal -> ${same}, +1 -> ${later}, -1 -> ${earlier} (ExpiryNotExtended)`,
  )
}

// F7: stale install snippet in the SDK README.
{
  const readme = readFileSync("node_modules/@arkiv-network/sdk/README.md", "utf8")
  const version = JSON.parse(readFileSync("node_modules/@arkiv-network/sdk/package.json", "utf8")).version as string
  const shown = /"@arkiv-network\/sdk":\s*"\^?(\d+\.\d+\.\d+)"/.exec(readme)?.[1]
  record("F7 README install snippet", shown !== undefined && shown !== version, `README shows ${shown}, installed ${version}`)
}

// F9: every query, a single-key lookup (what getEntity sends) included, costs 100 units of a small anonymous budget.
// The cost shows only in response headers; when the budget is gone the node answers 429 with a long Retry-After.
{
  const post = (body: object) => fetch(PUBLIC_HTTP, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const query = await post({ jsonrpc: "2.0", id: 1, method: "arkiv_query", params: ["app = str('abhichahiye')", { select: { key: true }, limit: "0x1" }] })
  if (query.status === 429) {
    const body = await query.text()
    record("F9 anonymous query budget", body.includes("ANON_COST_LIMITED"), `anonymous budget exhausted right now: 429 ${body.trim().slice(0, 140)} | retry-after ${query.headers.get("retry-after")} s`)
  } else {
    const lookup = await post({ jsonrpc: "2.0", id: 2, method: "arkiv_query", params: [`$key = key(${anchor.key})`, { select: { key: true }, limit: "0x1" }] })
    const head = await post({ jsonrpc: "2.0", id: 3, method: "eth_blockNumber", params: [] })
    const cost = (r: Response) => r.headers.get("arkiv-cost") ?? "none"
    record(
      "F9 anonymous query budget",
      cost(query) === "100" && cost(lookup) === "100" && cost(head) === "none",
      `arkiv_query costs ${cost(query)}, a one-key lookup ${cost(lookup)}, eth_blockNumber ${cost(head)} (headers only; ratelimit: ${query.headers.get("ratelimit")})`,
    )
  }
}

// F10: the Tiramisu chain definition has no blockTime, so viem caches getBlockNumber for 4 s (two blocks).
{
  const raw = async () => BigInt(((await (await fetch(PUBLIC_HTTP, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' })).json()) as { result: string }).result)
  const first = await client.getBlockNumber()
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const again = await client.getBlockNumber()
  const head = await raw()
  record(
    "F10 cached block number",
    tiramisu.blockTime === undefined && client.cacheTime === 4000 && again === first && head > again,
    `chain.blockTime ${tiramisu.blockTime}, client.cacheTime ${client.cacheTime} ms: getBlockNumber() gave ${first}, and ${again} again 3 s later, while the head was ${head}`,
  )
}

// F8: the SDK's page.next() fails once the chain head has moved; pinning atBlock for the whole walk works.
{
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const query = () => client.select({ key: true }).where(gte("$expiresAt", u64(currentBlock))).limit(200)

  const unpinnedFirst = await query().fetch()
  await sleep(5000)
  let failure: { code?: number; data?: { message?: string } } | undefined
  try {
    await unpinnedFirst.next()
  } catch (e) {
    failure = e as typeof failure
  }

  const pinnedFirst = await query().atBlock(unpinnedFirst.blockNumber).fetch()
  await sleep(5000)
  const pinnedSecond = await pinnedFirst.next()

  record(
    "F8 cursor pagination after the head moves",
    failure?.code === -32005 && pinnedSecond.entities.length > 0 && pinnedSecond.blockNumber === pinnedFirst.blockNumber,
    `page.next() 5 s later -> code ${failure?.code} "${failure?.data?.message}"; with .atBlock(${unpinnedFirst.blockNumber}) page 2 read fine at block ${pinnedSecond.blockNumber}`,
  )
}

// W1 (a path that works): pinned pagination returns distinct entities, every page at the pinned block.
{
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const pinned = currentBlock
  const seen = new Set<string>()
  const blocks = new Set<bigint>()
  let page = await client.select({ key: true }).where(gte("$expiresAt", u64(pinned))).limit(200).atBlock(pinned).fetch()
  let pages = 0
  while (pages < 3) {
    pages++
    blocks.add(page.blockNumber)
    for (const e of page.entities) seen.add(e.key)
    if (!page.hasNextPage()) break
    await sleep(2500)
    page = await page.next()
  }
  const ok = blocks.size === 1 && seen.size === pages * 200
  console.log(`${ok ? "WORKED         " : "BROKEN         "}  W1 pinned pagination  ${pages} pages over ${pages * 2.5}s, ${seen.size} distinct keys, block(s) ${[...blocks].join(",")}`)
  outcomes.push(ok)
}

console.log(`\n${outcomes.filter(Boolean).length}/${outcomes.length} checks behaved as documented in arkiv/friction.md`)
process.exit(outcomes.every(Boolean) ? 0 : 1)
