import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http, webSocket, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export const EXPLORER = "https://tiramisu.explorer.arkiv.network"
export const explorerTx = (hash: Hex) => `${EXPLORER}/tx/${hash}`
export const explorerAddress = (address: string) => `${EXPLORER}/address/${address}`

export const makePublicClient = () => createPublicClient({ chain: tiramisu, transport: http() })
export const makeWsClient = () => createPublicClient({ chain: tiramisu, transport: webSocket() })
export const makeWalletClient = (pk: Hex) =>
  createWalletClient({ chain: tiramisu, transport: http(), account: privateKeyToAccount(pk) })

export type PublicClient = ReturnType<typeof makePublicClient>
export type WalletClient = ReturnType<typeof makeWalletClient>
