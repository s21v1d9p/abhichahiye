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

export const keyedUrl = (key: string) => `${PUBLIC_HTTP}/${key}`
// Scripts run on a machine the operator controls, so they may use the access key directly.
export const fallbackFromKey = (key: string | undefined) => (key ? keyedUrl(key) : undefined)

const reasonOf = (body: { error?: string | { message?: string } }) =>
  typeof body.error === "string" ? body.error : (body.error?.message ?? "rate limited")

// Reads go to the public endpoint first: every arkiv_query costs 100 units, and an anonymous client gets a small
// budget before the endpoint answers 429 with a Retry-After of up to half an hour. viem would silently wait that out,
// so the page would just hang. Instead, move to `fallback` until the public budget resets (a keyed URL in scripts;
// in the browser the app's /api/rpc, which adds the key on the server), or fail at once with an error that says so.
export function arkivFetch(fallback?: string): typeof fetch {
  let fallbackUntil = 0
  return async (input, init) => {
    const onFallback = fallback !== undefined && Date.now() < fallbackUntil
    const response = await fetch(onFallback ? fallback : input, init)
    if (response.status !== 429) return response
    const retryAfter = Number(response.headers.get("retry-after") ?? "0") || 0
    if (fallback !== undefined && !onFallback) {
      fallbackUntil = Date.now() + Math.max(retryAfter, 60) * 1000
      return fetch(fallback, init)
    }
    if (retryAfter > LONG_WAIT_SECONDS) {
      const reason = await response
        .clone()
        .json()
        .then(reasonOf)
        .catch(() => "rate limited")
      throw new ArkivQuotaError(retryAfter, reason)
    }
    return response
  }
}

export const makePublicClient = (fallback?: string) =>
  createPublicClient({ chain: tiramisu, transport: http(PUBLIC_HTTP, { fetchFn: arkivFetch(fallback) }) })
// Subscriptions carry no query cost, so live events always use the public socket.
export const makeWsClient = () => createPublicClient({ chain: tiramisu, transport: webSocket(PUBLIC_WS) })
// Sending transactions costs no query units, so wallets always use the public endpoint and never need the key.
export const makeWalletClient = (pk: Hex) =>
  createWalletClient({ chain: tiramisu, transport: http(PUBLIC_HTTP, { fetchFn: arkivFetch() }), account: privateKeyToAccount(pk) })

export type PublicClient = ReturnType<typeof makePublicClient>
export type WalletClient = ReturnType<typeof makeWalletClient>
