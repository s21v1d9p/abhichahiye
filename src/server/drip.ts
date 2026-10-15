import { getAddress, type Hex, isAddress, parseEther } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { makePublicClient, makeWalletClient } from "../core/arkiv.js"

// Tops up a browser's test wallet with a little test GLM so a camp or donor can write to Arkiv without first
// visiting a faucet. Testnet only. Best-effort limits: per network address, and the drip wallet holds little.

export type DripDeps = {
  dripAddress: Hex
  amount: bigint
  skipAbove: bigint
  balanceOf: (address: Hex) => Promise<bigint>
  // Sends and waits until the transfer is confirmed, so the browser can write straight away.
  send: (to: Hex, value: bigint) => Promise<Hex>
  now?: () => number
}

export type DripReply = { status: number; body: { txHash?: Hex; skipped?: "already funded"; error?: string } }

const WINDOW_MS = 10 * 60_000
const PER_WINDOW = 5
const MAX_TRACKED = 10_000

export function createDrip(deps: DripDeps) {
  const now = deps.now ?? Date.now
  const recent = new Map<string, number[]>()
  let queue: Promise<unknown> = Promise.resolve()

  // One transfer at a time from this instance: concurrent sends from one wallet would race for the same nonce.
  const serially = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  return async function drip(body: unknown, ip: string): Promise<DripReply> {
    const address = (body as { address?: unknown } | null)?.address
    if (typeof address !== "string" || !isAddress(address)) {
      return { status: 400, body: { error: 'Send a JSON body like {"address": "0x…"}' } }
    }
    // Counted before anything is awaited, so simultaneous requests from one network all see each other.
    const at = now()
    const hits = (recent.get(ip) ?? []).filter((t) => at - t < WINDOW_MS)
    if (hits.length >= PER_WINDOW) {
      return { status: 429, body: { error: "Too many top-ups from this network. Try again in a few minutes." } }
    }
    if (recent.size > MAX_TRACKED) recent.clear()
    recent.set(ip, [...hits, at])
    const to = getAddress(address)

    // The balance is checked inside the queue, after any transfer already on its way to this address has landed.
    return serially(async () => {
      if ((await deps.balanceOf(to)) >= deps.skipAbove) return { status: 200, body: { skipped: "already funded" } }
      if ((await deps.balanceOf(deps.dripAddress)) < deps.amount * 2n) {
        return { status: 503, body: { error: "The test-GLM drip is empty. Claim from https://hub.arkiv.network/faucet instead." } }
      }
      return { status: 200, body: { txHash: await deps.send(to, deps.amount) } }
    })
  }
}

export type Drip = ReturnType<typeof createDrip>

// The drip used by the deployed API and the dev server. Undefined when DRIP_PK is not set.
export function dripFromEnv(env: Record<string, string | undefined>): Drip | undefined {
  const key = env.DRIP_PK as Hex | undefined
  if (!key) return undefined
  const pub = makePublicClient()
  const wallet = makeWalletClient(key)
  return createDrip({
    dripAddress: privateKeyToAccount(key).address,
    amount: parseEther(env.DRIP_AMOUNT ?? "0.01"),
    skipAbove: parseEther(env.DRIP_SKIP_ABOVE ?? "0.005"),
    balanceOf: (address) => pub.getBalance({ address }),
    send: async (to, value) => {
      const hash = await wallet.sendTransaction({ to, value })
      await pub.waitForTransactionReceipt({ hash })
      return hash
    },
  })
}
