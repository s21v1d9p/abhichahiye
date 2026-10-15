import { useCallback, useEffect, useMemo, useState } from "react"
import { type Hex, parseEther } from "viem"
import { generatePrivateKey } from "viem/accounts"
import { useBackend } from "./backend"

const STORAGE_KEY = "abhichahiye:wallet"
const LOW = parseEther("0.001")

// A test wallet kept in this browser, so a camp coordinator or donor can write to Arkiv without installing anything.
// Testnet only: the key lives in localStorage and the wallet only ever holds a few cents' worth of test GLM.
function storedKey(): Hex {
  const existing = localStorage.getItem(STORAGE_KEY)
  if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) return existing as Hex
  const fresh = generatePrivateKey()
  localStorage.setItem(STORAGE_KEY, fresh)
  return fresh
}

export function useBrowserWallet() {
  const backend = useBackend()
  const [privateKey] = useState(storedKey)
  const client = useMemo(() => backend.makeWallet(privateKey), [backend, privateKey])
  const address = client.account.address
  const [balance, setBalance] = useState<bigint>()
  const [funding, setFunding] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setBalance(await backend.pub.getBalance({ address }))
    } catch {
      // Keep showing the last known balance; the next write will say if the network is unreachable.
    }
  }, [backend, address])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const fund = useCallback(async () => {
    setFunding(true)
    try {
      const result = await backend.fund(address)
      await refresh()
      return result
    } finally {
      setFunding(false)
    }
  }, [backend, address, refresh])

  // Called before every write, so the first thing a new camp does just works.
  const ensureFunds = useCallback(async () => {
    const current = balance ?? (await backend.pub.getBalance({ address }))
    if (current < LOW) await fund()
  }, [backend, address, balance, fund])

  return { client, address, balance, funding, refresh, fund, ensureFunds }
}

export type BrowserWallet = ReturnType<typeof useBrowserWallet>
