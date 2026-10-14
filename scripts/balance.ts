import { createPublicClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { formatEther, http, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const pk = process.env.FUNDER_PK as Hex | undefined
if (!pk) throw new Error("FUNDER_PK missing in .env")
const address = privateKeyToAccount(pk).address
const client = createPublicClient({ chain: tiramisu, transport: http() })
console.log(address, formatEther(await client.getBalance({ address })), "GLM")
