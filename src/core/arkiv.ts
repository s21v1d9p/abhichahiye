import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http, webSocket, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export const PUBLIC_HTTP = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
export const PUBLIC_WS = "wss://rpc.tiramisu.db-chain.testnet.arkiv.network"

export const EXPLORER = "https://tiramisu.explorer.arkiv.network"
export const explorerTx = (hash: Hex) => `${EXPLORER}/tx/${hash}`
export const explorerAddress = (address: string) => `${EXPLORER}/address/${address}`

export class ArkivQuotaError extends Error {
  constructor(
    readonly retryAfterSeconds: number,
    readonly reason: string,
  ) {
    super(`Arkiv's public endpoint has paused queries from this client for about ${Math.max(1, Math.round(retryAfterSeconds / 60))} min (${reason}).`)
    this.name = "ArkivQuotaError"
  }
}

const LONG_WAIT_SECONDS = 30

// Reads go to the public endpoint first: every arkiv_query costs 100 units, and an anonymous client gets a small
// budget before the endpoint answers 429 with a Retry-After of up to half an hour. viem would silently wait that out,
// so the page would just hang. Instead, switch to the access key (if configured) until the anonymous budget resets,
// or fail at once with an error that says what happened.
export function arkivFetch(key?: string): typeof fetch {
  let keyedUntil = 0
  const keyed = key ? `${PUBLIC_HTTP}/${key}` : undefined
  return async (input, init) => {
    const onKey = keyed !== undefined && Date.now() < keyedUntil
    const response = await fetch(onKey ? keyed : input, init)
    if (response.status !== 429) return response
    const retryAfter = Number(response.headers.get("retry-after") ?? "0") || 0
    if (keyed !== undefined && !onKey) {
      keyedUntil = Date.now() + Math.max(retryAfter, 60) * 1000
      return fetch(keyed, init)
    }
    if (retryAfter > LONG_WAIT_SECONDS) {
      const reason = await response
        .clone()
        .json()
        .then((body: { error?: string }) => body.error ?? "rate limited")
        .catch(() => "rate limited")
      throw new ArkivQuotaError(retryAfter, reason)
    }
    return response
  }
}

const transport = (key?: string) => http(PUBLIC_HTTP, { fetchFn: arkivFetch(key) })

export const makePublicClient = (key?: string) => createPublicClient({ chain: tiramisu, transport: transport(key) })
// Subscriptions carry no query cost, so live events always use the public socket.
export const makeWsClient = () => createPublicClient({ chain: tiramisu, transport: webSocket(PUBLIC_WS) })
export const makeWalletClient = (pk: Hex, key?: string) =>
  createWalletClient({ chain: tiramisu, transport: transport(key), account: privateKeyToAccount(pk) })

export type PublicClient = ReturnType<typeof makePublicClient>
export type WalletClient = ReturnType<typeof makeWalletClient>
