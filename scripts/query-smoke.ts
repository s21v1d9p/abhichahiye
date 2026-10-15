import { and } from "@arkiv-network/sdk/query"
import { makePublicClient } from "../src/core/arkiv"
import { computeGaps } from "../src/core/gaps"
import { boxWhere, loadDistrict, needsInBox, needsWhere } from "../src/core/queries"

const district = process.argv[2] ?? "dhemaji"
const client = makePublicClient()

const { currentBlock, blockDuration } = await client.getBlockTiming()
console.log(`tiramisu block ${currentBlock} (${blockDuration}s blocks), ${await client.getEntityCount()} entities on chain`)

console.log("district need query:", and(needsWhere({ district })).toString())

const data = await loadDistrict(client, { district })
const clock = { nowUnix: Math.floor(Date.now() / 1000), block: data.block }
const gaps = computeGaps(data.needs, data.pledges, data.receipts, data.sitesByKey, clock)
console.log(
  `district ${district} @ block ${data.block}: needs=${data.needs.length} pledges=${data.pledges.length} receipts=${data.receipts.length} sites=${data.sites.length} orgs=${data.orgs.length} vouches=${data.vouches.length} authentic-gaps=${gaps.length} truncated=${data.truncated}`,
)

const box = { south: 24, west: 89, north: 29, east: 97 }
console.log("assam box query:", and(boxWhere(box)).toString())
console.log(`needs in assam box: ${(await needsInBox(client, box)).length}`)
