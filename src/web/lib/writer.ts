import { useCallback } from "react"
import type { Hex } from "viem"
import { useBackend } from "./backend"
import { useBoard } from "./store"
import { useTx } from "./tx"
import type { BrowserWallet } from "./wallet"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const ATTEMPTS = 8

// Every console write: top the wallet up if it is empty, sign and send, then re-read this page and the board.
// `reload` returns the block it read at. The query index can trail a transaction receipt by a second or more, so the
// page is re-read until it reflects the block the write landed in; otherwise it would show the state before the write.
export function useWriter(wallet: BrowserWallet, reload: () => Promise<bigint | undefined>) {
  const backend = useBackend()
  const { refresh: refreshBoard } = useBoard()
  const tx = useTx()
  const { run } = tx
  const write = useCallback(
    async (label: string, task: () => Promise<unknown>) => {
      // The status stays "writing" until the page shows the result, so nobody acts on a stale card.
      const ok = await run(label, async () => {
        await wallet.ensureFunds()
        const result = await task()
        const hash = (result as { txHash?: Hex } | undefined)?.txHash
        const landed = hash && backend.mode === "tiramisu" ? (await backend.pub.getTransactionReceipt({ hash }).catch(() => undefined))?.blockNumber : undefined
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
          const read = await reload()
          if (landed === undefined || (read !== undefined && read >= landed)) break
          await sleep(750)
        }
        return result
      })
      if (!ok) return false
      await wallet.refresh()
      refreshBoard()
      return true
    },
    [run, wallet, reload, backend, refreshBoard],
  )
  return { tx, write }
}
