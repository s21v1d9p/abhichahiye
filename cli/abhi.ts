import type { Hex } from "viem"
import { makePublicClient } from "../src/core/arkiv"
import { secondsLeft } from "../src/core/expiry"
import { formatDuration, renderTable, shortHex } from "../src/core/format"
import { computeGaps } from "../src/core/gaps"
import { loadDistrict, loadNeed } from "../src/core/queries"
import { n, s } from "../src/core/records"

const USAGE = `AbhiChahiye command line. Reads Arkiv (Tiramisu) directly over public RPC; no AbhiChahiye server is involved.

  npm run abhi -- gaps <district> [--urgent] [--json]   what the camps in a district still need
  npm run abhi -- need <key>                            is a forwarded need still live?

Exit code of "need": 0 when it is live, 2 when it must not be forwarded.`

const [command, argument, ...rest] = process.argv.slice(2)
const flags = new Set(rest)
const client = makePublicClient()

async function gaps(district: string) {
  const data = await loadDistrict(client, { district, minUrgency: flags.has("--urgent") ? 2 : 1 })
  const clock = { nowUnix: Math.floor(Date.now() / 1000), block: data.block }
  const rows = computeGaps(data.needs, data.pledges, data.receipts, data.sitesByKey, clock).map((g) => ({
    need: g.need.key,
    camp: String(data.sitesByKey.get(s(g.need, "site"))?.payload.name ?? shortHex(s(g.need, "site"))),
    confirmedBy: g.need.creator,
    item: s(g.need, "item"),
    urgency: n(g.need, "urgency"),
    qty: g.qty,
    pledged: g.pledged,
    gap: g.gap,
    expiresInSeconds: secondsLeft(g.need.expiresAt, data.block),
  }))

  if (flags.has("--json")) {
    console.log(JSON.stringify(rows, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2))
    return
  }
  if (rows.length === 0) {
    console.log(`No live, authentic needs in ${district} at block ${data.block}.`)
    console.log("A need disappears by itself when its camp stops re-confirming it, so an empty list is a real answer.")
  } else {
    const table = rows.map((r) => [
      r.camp,
      r.item,
      String(r.urgency),
      String(r.qty),
      String(r.pledged),
      String(r.gap),
      formatDuration(r.expiresInSeconds),
      shortHex(r.confirmedBy),
    ])
    console.log(renderTable(["Camp", "Item", "Urgency", "Needs", "Pledged", "Still short", "Expires in", "Confirmed by"], table))
    console.log(`\n${rows.length} live need(s) in ${district} at block ${data.block}.`)
  }
  if (data.truncated) console.log("Warning: a result limit was reached, so some entities are not shown.")
}

async function need(key: string) {
  const view = await loadNeed(client, key as Hex)
  if (view.state === "live") {
    const left = formatDuration(secondsLeft(view.need.expiresAt, view.block))
    const camp = String(view.site.payload.name ?? shortHex(view.site.key))
    console.log(`LIVE: ${s(view.need, "item")} x${view.gap.qty} at ${camp} (${s(view.need, "district")})`)
    console.log(`  urgency ${n(view.need, "urgency")}, still short ${view.gap.gap} after ${view.gap.pledged} pledged`)
    console.log(`  confirmed by the camp wallet ${view.need.creator}; lapses in ${left} unless the camp confirms it again`)
    return
  }
  const message = {
    gone: "EXPIRED / NOT FOUND: do not forward",
    foreign: "NOT AN ABHICHAHIYE NEED: do not forward",
    orphan: "ITS CAMP LISTING HAS EXPIRED: do not forward",
    forged: "NOT WRITTEN BY ITS CAMP: do not forward",
  }[view.state]
  console.log(message)
  process.exitCode = 2
}

if (command === "gaps" && argument) await gaps(argument)
else if (command === "need" && argument) await need(argument)
else {
  console.log(USAGE)
  process.exitCode = command ? 1 : 0
}
