import { and } from "@arkiv-network/sdk/query"
import { makePublicClient } from "../src/core/arkiv"
import { boxWhere, loadDistrict, needsInBox, needsWhere } from "../src/core/queries"
import { computeGaps } from "../src/core/gaps"

const district = process.argv[2] ?? "dhemaji"
const client = makePublicClient()

const { currentBlock, blockDuration } = await client.getBlockTiming()
console.log(`tiramisu block ${currentBlock} (${blockDuration}s blocks), ${await client.getEntityCount()} entities on chain`)

const query = and(needsWhere({ district })).toString()
console.log("district need query:", query)

const data = await loadDistrict(client, { district })
const gaps = computeGaps(data.needs, data.pledges, data.receipts, data.sitesByKey)
console.log(
  `district ${district}: needs=${data.needs.length} pledges=${data.pledges.length} receipts=${data.receipts.length} sites=${data.sites.length} orgs=${data.orgs.length} vouches=${data.vouches.length} authentic-gaps=${gaps.length}`,
)

const box = { south: 24, west: 89, north: 29, east: 97 }
const inBox = await needsInBox(client, box)
console.log("assam box query:", and(boxWhere(box)).toString())
console.log(`needs in assam box: ${inBox.length}`)
