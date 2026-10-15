import { createContext, type ReactNode, useContext, useEffect, useState } from "react"
import type { Hex } from "viem"
import { makePublicClient, makeWalletClient, makeWsClient, type PublicClient, type WalletClient } from "../../core/arkiv"
import { TRUSTED_AUTHORITIES } from "./config"

export type Backend = {
  mode: "tiramisu" | "memory"
  pub: PublicClient
  // Chain-wide entity events. Opened lazily so pages that never watch do not hold a socket.
  events: () => Pick<PublicClient, "watchEntityEvents">
  authorities: Hex[]
  makeWallet: (privateKey: Hex) => WalletClient
  // Tops up a test wallet. Resolves to what happened, for the UI to explain.
  fund: (address: Hex) => Promise<"funded" | "already funded">
}

async function createTiramisu(): Promise<Backend> {
  // An Arkiv access key, if this build has one, is only used once the public endpoint's anonymous budget runs out.
  const key = import.meta.env.VITE_ARKIV_KEY as string | undefined
  const pub = makePublicClient(key)
  let ws: Pick<PublicClient, "watchEntityEvents"> | undefined
  return {
    mode: "tiramisu",
    pub,
    events: () => (ws ??= makeWsClient()),
    authorities: TRUSTED_AUTHORITIES,
    makeWallet: (privateKey) => makeWalletClient(privateKey, key),
    async fund(address) {
      const res = await fetch("/api/drip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; skipped?: string }
      if (!res.ok) throw new Error(body.error ?? `drip failed (${res.status})`)
      return body.skipped ? "already funded" : "funded"
    },
  }
}

// Development only: run the real UI and real core code against an in-memory chain, so the interface can be built
// and looked at without any testnet funds. The production bundle never contains this branch.
async function createMemory(demoExpiry: boolean): Promise<Backend> {
  const { createMemChain } = await import("../../core/memchain")
  const { ROLES, runScenario } = await import("../../core/scenario")
  type Wallets = Parameters<typeof runScenario>[1]
  const chain = createMemChain({ auto: true })
  const wallets = Object.fromEntries(ROLES.map((role) => [role, chain.wallet()])) as Wallets
  await runScenario(chain.pub, wallets, { demoExpiry })
  ;(window as unknown as { __mem: unknown }).__mem = { chain, wallets }
  return {
    mode: "memory",
    pub: chain.pub,
    events: () => chain.pub,
    authorities: [wallets.authority.account.address],
    makeWallet: (privateKey) => chain.wallet(privateKey),
    fund: async () => "funded",
  }
}

async function create(): Promise<Backend> {
  const params = new URLSearchParams(window.location.search)
  if (import.meta.env.DEV && params.has("mem")) return createMemory(params.has("demo"))
  return createTiramisu()
}

const BackendContext = createContext<Backend | undefined>(undefined)

export function BackendProvider({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend>()
  const [failure, setFailure] = useState<string>()
  useEffect(() => {
    create().then(setBackend, (e: unknown) => setFailure(e instanceof Error ? e.message : String(e)))
  }, [])
  if (failure) return <p className="splash">Could not start: {failure}</p>
  if (!backend) return <p className="splash">Connecting to Arkiv…</p>
  return <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>
}

export function useBackend(): Backend {
  const backend = useContext(BackendContext)
  if (!backend) throw new Error("useBackend must be used inside BackendProvider")
  return backend
}
