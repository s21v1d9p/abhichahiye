// Read-only smoke test against Tiramisu: the same reads the board and the map make, with their exact predicates.
//   npx tsx scripts/query-smoke.ts [district]
import { makePublicClient } from "../src/core/arkiv"
import { computeGaps } from "../src/core/gaps"
import { boxWhere, districtWhere, loadBox, loadDistrict, toQueryString } from "../src/core/queries"

const district = process.argv[2] ?? "dhemaji"
const client = makePublicClient(process.env.VITE_ARKIV_KEY)

const { currentBlock, blockDuration } = await client.getBlockTiming()
console.log(`tiramisu block ${currentBlock} (${blockDuration}s blocks)`)

console.log("district query:", toQueryString(districtWhere(district)))
const data = await loadDistrict(client, { district })
const gaps = computeGaps(data.needs, data.pledges, data.receipts, data.sitesByKey, { nowUnix: Math.floor(Date.now() / 1000), block: data.block })
console.log(
  `district ${district} @ block ${data.block}: needs=${data.needs.length} pledges=${data.pledges.length} receipts=${data.receipts.length} sites=${data.sites.length} orgs=${data.orgs.length} vouches=${data.vouches.length} authentic-gaps=${gaps.length} truncated=${data.truncated}`,
)

const box = { south: 24, west: 89, north: 29, east: 97 }
console.log("assam box query:", toQueryString(boxWhere(box)))
const view = await loadBox(client, box)
console.log(`assam box: ${view.sites.length} sites, ${view.needs.length} authentic needs`)
