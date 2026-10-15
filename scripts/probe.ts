// Exercises, with real transactions on Tiramisu, every Arkiv behaviour AbhiChahiye depends on, and records the
// evidence: transaction hashes, gas, cost, timings, and the live events seen over a WebSocket subscription.
// Probe entities carry app = "abhichahiye-probe", so they never reach the board.
//   npm run probe      (needs FUNDER_PK in .env; funds a throwaway wallet with 0.01 GLM and spends far less)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { ExpirationTime, NoEntityFoundError } from "@arkiv-network/sdk"
import { str, u64 } from "@arkiv-network/sdk/attr"
import { eq } from "@arkiv-network/sdk/query"
import { jsonToPayload } from "@arkiv-network/sdk/utils"
import { formatEther, type Hex, parseEther } from "viem"
import { generatePrivateKey } from "viem/accounts"
import { explorerAddress, explorerTx, fallbackFromKey, makePublicClient, makeWalletClient, makeWsClient } from "../src/core/arkiv"

const APP = "abhichahiye-probe"
const OUT = "docs/evidence/probe.json"

const funderKey = process.env.FUNDER_PK as Hex | undefined
if (!funderKey) throw new Error("FUNDER_PK missing in .env")

const pub = makePublicClient(fallbackFromKey(process.env.ARKIV_KEY))
const ws = makeWsClient()
const funder = makeWalletClient(funderKey)
const probe = makeWalletClient(generatePrivateKey())

type TxRecord = { step: string; hash: Hex; block: string; gasUsed: string; costGlm: string; explorer: string }
type Finding = { id: string; step: string; ok: boolean; detail: string }
type Seen = { at: number; type: string; key: string; block: string }

const txs: TxRecord[] = []
const findings: Finding[] = []
const events: Seen[] = []

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const json = (o: object) => ({ payload: jsonToPayload(o), contentType: "application/json" as const })
const lower = (key: string) => key.toLowerCase()

// The chain of causes a developer would have to dig through, first line of each, without repeats.
function messages(error: unknown): string[] {
  const out: string[] = []
  for (let cur: unknown = error; cur instanceof Error && out.length < 10; cur = (cur as { cause?: unknown }).cause) {
    const e = cur as Error & { shortMessage?: string; details?: string }
    const line = (e.shortMessage ?? e.details ?? e.message).split("\n")[0]?.trim() ?? ""
    if (line && !out.includes(line)) out.push(line)
  }
  return out
}

function check(id: string, step: string, ok: boolean, detail: string) {
  findings.push({ id, step, ok, detail })
  console.log(`${ok ? "OK  " : "FAIL"}  ${id.padEnd(4)} ${step}: ${detail}`)
}

async function recordTx(step: string, hash: Hex) {
  const receipt = await pub.waitForTransactionReceipt({ hash })
  const cost = receipt.gasUsed * receipt.effectiveGasPrice
  txs.push({
    step,
    hash,
    block: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    costGlm: formatEther(cost),
    explorer: explorerTx(hash),
  })
  if (receipt.status !== "success") throw new Error(`${step}: transaction ${hash} reverted`)
  return receipt
}

// A step that is expected to work. If it throws, the finding records why and the probe carries on.
async function step<T>(id: string, name: string, run: () => Promise<{ ok: boolean; detail: string; value?: T }>) {
  try {
    const { ok, detail, value } = await run()
    check(id, name, ok, detail)
    return value
  } catch (error) {
    check(id, name, false, `threw: ${messages(error).join(" <- ")}`)
    return undefined
  }
}

async function refusal(run: () => Promise<unknown>): Promise<string[] | undefined> {
  try {
    await run()
    return undefined
  } catch (error) {
    return messages(error)
  }
}

async function live(key: Hex) {
  try {
    return await pub.getEntity(key)
  } catch (error) {
    if (error instanceof NoEntityFoundError) return undefined
    throw error
  }
}

async function waitFor<T>(poll: () => Promise<T | undefined>, timeoutMs: number, everyMs = 250) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await poll()
    if (value !== undefined) return { value, ms: Date.now() - started }
    await sleep(everyMs)
  }
  return undefined
}

const qtyOf = (entity: Awaited<ReturnType<typeof live>>) => entity?.attributes.qty?.value

const timing = await pub.getBlockTiming()
const sdkVersion = JSON.parse(readFileSync("node_modules/@arkiv-network/sdk/package.json", "utf8")).version as string
console.log(`Tiramisu block ${timing.currentBlock} (${timing.blockDuration}s blocks), SDK ${sdkVersion}`)
console.log(`probe wallet ${probe.account.address}\n`)

const unwatch = ws.watchEntityEvents({
  onEvent: (e) => events.push({ at: Date.now(), type: e.type, key: lower(e.entityKey), block: e.blockNumber.toString() }),
  onError: (e) => console.log(`event stream error: ${e.message.split("\n")[0]}`),
})

// P1: a brand-new wallet becomes usable as soon as it is funded, which is how a camp's burner wallet gets started.
{
  const started = Date.now()
  const hash = await funder.sendTransaction({ to: probe.account.address, value: parseEther("0.01") })
  await recordTx("fund a new wallet with 0.01 GLM", hash)
  check("P1", "fund a new wallet", true, `funded and confirmed in ${Date.now() - started} ms`)
}

// P2: create, then measure how long until a query returns it.
const started = Date.now()
const created = await probe.createEntity({
  ...json({ note: "probe" }),
  attributes: { app: str(APP), kind: str("probe"), qty: u64(300n) },
  expires: ExpirationTime.fromSeconds(600),
})
const createMs = Date.now() - started
await recordTx("createEntity", created.txHash)
await step("P2", "create and query back", async () => {
  const visible = await waitFor(async () => {
    const page = await pub.select({ key: true }).where(eq("app", APP), eq("kind", "probe")).createdBy(probe.account.address).limit(10).fetch()
    return page.entities.some((e) => lower(e.key) === lower(created.entityKey)) ? true : undefined
  }, 20_000)
  return {
    ok: !!visible,
    detail: `createEntity resolved after ${createMs} ms (it waits for the receipt); a query returned it ${visible ? `${visible.ms} ms later` : "NOT within 20 s"}`,
  }
})

// P3: patch one attribute.
await step("P3", "patch an attribute", async () => {
  const { txHash } = await probe.patchEntity({ entityKey: created.entityKey, set: { qty: u64(180n) } })
  await recordTx("patchEntity qty 300 -> 180", txHash)
  const qty = qtyOf(await live(created.entityKey))
  return { ok: qty === 180n, detail: `qty is now ${qty}` }
})

// P4: one atomic batch with a create, a patch and a Lifetime Extension: the shape of "post a need" and "record a delivery".
const second = await step<Hex>("P4", "one batch: create + patch + extend", async () => {
  const before = await live(created.entityKey)
  if (!before) throw new Error("probe entity vanished")
  const batch = await probe.executeBatch({
    creates: [{ ...json({}), attributes: { app: str(APP), kind: str("probe-batch") }, expires: ExpirationTime.fromSeconds(600) }],
    patches: [{ entityKey: created.entityKey, set: { qty: u64(120n) } }],
    extensions: [{ entityKey: created.entityKey, expires: ExpirationTime.atBlock(before.expiresAt + 300n) }],
  })
  await recordTx("executeBatch create + patch + extend", batch.txHash)
  const after = await live(created.entityKey)
  const made = batch.createdEntities[0]
  const ok = qtyOf(after) === 120n && after?.expiresAt === before.expiresAt + 300n && !!made && !!(await live(made))
  return {
    ok,
    detail: `one transaction: qty ${qtyOf(after)}, expiry ${before.expiresAt} -> ${after?.expiresAt} (+300 blocks), new entity ${made}`,
    ...(made ? { value: made } : {}),
  }
})

// F5: extend to exactly the current expiry. The challenge docs say this reverts; the engine accepts it.
const current = (await live(created.entityKey))?.expiresAt
if (current === undefined) throw new Error("probe entity vanished")
await step("F5", "extend to the same expiry", async () => {
  const { txHash } = await probe.extendEntity({ entityKey: created.entityKey, expires: ExpirationTime.atBlock(current) })
  await recordTx("extendEntity to the SAME expiry (F5)", txHash)
  const after = (await live(created.entityKey))?.expiresAt
  return { ok: after === current, detail: `real transaction succeeded and changed nothing (expiry still block ${after})` }
})

// P6: an earlier expiry is refused before anything is sent.
await step("P6", "extend to an earlier expiry", async () => {
  const why = await refusal(() => probe.extendEntity({ entityKey: created.entityKey, expires: ExpirationTime.atBlock(current - 1n) }))
  return { ok: !!why, detail: why ? `refused, nothing sent: ${why.join(" <- ")}` : "was accepted" }
})

// F4: the SDK accepts an uppercase attribute name; the engine does not.
await step("F4", "uppercase attribute name", async () => {
  const why = await refusal(() =>
    probe.createEntity({ ...json({}), attributes: { app: str(APP), Qty: u64(1n) }, expires: ExpirationTime.fromSeconds(60) }),
  )
  return { ok: !!why, detail: why ? `the SDK built and signed it; the node refused it at gas estimation: ${why.join(" <- ")}` : "was accepted" }
})

// P8: read-only entities (receipts and vouches) cannot be changed, but can they be extended and withdrawn?
const readonly = await step<{ key: Hex; expiresAt: bigint }>("P8a", "create a read-only entity", async () => {
  const made = await probe.createEntity({
    ...json({}),
    attributes: { app: str(APP), kind: str("probe-readonly"), qty: u64(1n) },
    expires: ExpirationTime.fromSeconds(600),
    flags: { readonly: true },
  })
  await recordTx("createEntity readonly", made.txHash)
  return { ok: true, detail: `created ${made.entityKey}`, value: { key: made.entityKey, expiresAt: made.expiresAt } }
})
if (readonly) {
  await step("P8b", "patch a read-only entity", async () => {
    const why = await refusal(() => probe.patchEntity({ entityKey: readonly.key, set: { qty: u64(2n) } }))
    return { ok: !!why, detail: why ? `refused, nothing sent: ${why.join(" <- ")}` : "was accepted" }
  })
  await step("P8c", "extend a read-only entity", async () => {
    const { txHash } = await probe.extendEntity({ entityKey: readonly.key, expires: ExpirationTime.atBlock(readonly.expiresAt + 100n) })
    await recordTx("extendEntity readonly", txHash)
    const after = (await live(readonly.key))?.expiresAt
    return { ok: after === readonly.expiresAt + 100n, detail: `allowed: expiry ${readonly.expiresAt} -> ${after}` }
  })
  await step("P8d", "delete a read-only entity", async () => {
    const { txHash } = await probe.deleteEntity({ entityKey: readonly.key })
    await recordTx("deleteEntity readonly", txHash)
    const gone = !(await live(readonly.key))
    return { ok: gone, detail: gone ? "allowed: its owner can withdraw it (an authority can revoke a vouch early)" : "still there" }
  })
}

// P9: delete.
if (second) {
  await step("P9", "delete", async () => {
    const { txHash } = await probe.deleteEntity({ entityKey: second })
    await recordTx("deleteEntity", txHash)
    const gone = !(await live(second))
    return { ok: gone, detail: gone ? "getEntity now throws NoEntityFoundError" : "still there" }
  })
}

// P10: Entity Expiration in real time, with an entity that lives ten seconds.
const short = await step<{ key: Hex; expiresAt: bigint }>("P10", "Entity Expiration (10 s lifetime)", async () => {
  const made = await probe.createEntity({
    ...json({}),
    attributes: { app: str(APP), kind: str("probe-short") },
    expires: ExpirationTime.fromSeconds(10),
  })
  const createdAt = Date.now()
  await recordTx("createEntity with a 10 s lifetime", made.txHash)
  const gone = await waitFor(async () => ((await live(made.entityKey)) ? undefined : true), 90_000, 1000)
  const head = await pub.getBlockNumber()
  const page = await pub.select({ key: true }).where(eq("app", APP), eq("kind", "probe-short")).createdBy(probe.account.address).limit(10).fetch()
  return {
    ok: !!gone && page.entities.length === 0,
    detail: `expiresAt block ${made.expiresAt}; getEntity stopped finding it ${gone ? `${Math.round((Date.now() - createdAt) / 1000)} s after creation` : "NOT within 90 s"} (head now ${head}); queries return ${page.entities.length}`,
    value: { key: made.entityKey, expiresAt: made.expiresAt },
  }
})

// P11: what arrived over the WebSocket subscription for the probe's own entities.
await sleep(6000)
unwatch()
const ours = new Set([created.entityKey, second, readonly?.key, short?.key].filter((k): k is Hex => !!k).map(lower))
const mine = events.filter((e) => ours.has(e.key))
const kinds = new Set(mine.map((e) => e.type))
const afterExpiry = short ? mine.filter((e) => e.key === lower(short.key) && e.type !== "EntityCreated") : []
check(
  "P11",
  "live events over WebSocket",
  ["EntityCreated", "EntityPatched", "ExpiryExtended", "EntityDeleted"].every((t) => kinds.has(t)) && afterExpiry.length === 0,
  `${mine.length} events for probe entities (${[...kinds].join(", ")}); ${events.length} chain-wide in total; events when the 10 s entity expired: ${afterExpiry.length}`,
)

const totalGas = txs.reduce((sum, t) => sum + BigInt(t.gasUsed), 0n)
const totalCost = txs.reduce((sum, t) => sum + parseEther(t.costGlm), 0n)
console.log("\n| Step | Gas used | Cost (GLM) | Transaction |\n|---|---:|---:|---|")
for (const t of txs) console.log(`| ${t.step} | ${t.gasUsed} | ${t.costGlm} | [${t.hash.slice(0, 10)}…](${t.explorer}) |`)
console.log(`\n${txs.length} transactions, ${totalGas} gas, ${formatEther(totalCost)} GLM in total`)
console.log(`probe wallet: ${explorerAddress(probe.account.address)}`)

mkdirSync("docs/evidence", { recursive: true })
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      chain: "Tiramisu (7738577)",
      sdk: sdkVersion,
      startBlock: timing.currentBlock.toString(),
      probeWallet: probe.account.address,
      funder: funder.account.address,
      findings,
      transactions: txs,
      totals: { transactions: txs.length, gas: totalGas.toString(), costGlm: formatEther(totalCost) },
      events: mine.map(({ type, key, block }) => ({ type, key, block })),
      chainWideEventsSeen: events.length,
    },
    null,
    2,
  )}\n`,
)
console.log(`evidence written to ${OUT}`)

const failed = findings.filter((f) => !f.ok)
console.log(failed.length === 0 ? "\nALL PROBES BEHAVED AS EXPECTED" : `\n${failed.length} PROBE(S) DID NOT BEHAVE AS EXPECTED`)
process.exit(failed.length === 0 ? 0 : 1)
