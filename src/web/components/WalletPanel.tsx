import { useState } from "react"
import { formatEther } from "viem"
import { explorerAddress, explorerTx } from "../../core/arkiv"
import { shortHex } from "../../core/format"
import { useBackend } from "../lib/backend"
import type { TxState } from "../lib/tx"
import type { BrowserWallet } from "../lib/wallet"

const glm = (wei: bigint) => Number(formatEther(wei)).toFixed(4)

export function WalletPanel({ wallet, role }: { wallet: BrowserWallet; role: string }) {
  const backend = useBackend()
  const [note, setNote] = useState<string>()
  const empty = wallet.balance !== undefined && wallet.balance === 0n

  return (
    <aside className="wallet" aria-label="Your test wallet">
      <div className="wallet__id">
        <span className="field__label">{role} wallet</span>
        {backend.mode === "tiramisu" ? (
          <a className="wallet__address" href={explorerAddress(wallet.address)} target="_blank" rel="noreferrer" title={wallet.address}>
            {shortHex(wallet.address, 8, 6)}
          </a>
        ) : (
          <span className="wallet__address" title={wallet.address}>
            {shortHex(wallet.address, 8, 6)}
          </span>
        )}
      </div>
      <div className="wallet__balance">
        <span className="field__label">Test GLM</span>
        <span className="wallet__glm">{wallet.balance === undefined ? "…" : glm(wallet.balance)}</span>
      </div>
      <button
        type="button"
        className={empty ? "btn btn--small" : "btn btn--small btn--ghost"}
        disabled={wallet.funding}
        onClick={async () => {
          setNote(undefined)
          try {
            const result = await wallet.fund()
            setNote(result === "already funded" ? "You already have enough for many writes." : "Topped up.")
          } catch (error) {
            setNote(error instanceof Error ? error.message : String(error))
          }
        }}
      >
        {wallet.funding ? "Sending…" : "Get test GLM"}
      </button>
      <p className="wallet__note">
        {note ??
          "A test wallet kept in this browser. Every write is signed by it and is public on the Tiramisu testnet. It holds only free test GLM; one write costs about 0.0001."}
      </p>
    </aside>
  )
}

export function TxStatus({ state }: { state: TxState }) {
  const backend = useBackend()
  if (state.status === "idle") return null
  return (
    <p className={`txstatus txstatus--${state.status}`} role={state.status === "error" ? "alert" : "status"}>
      {state.status === "pending" && <span className="txstatus__spin" aria-hidden="true" />}
      <b>{state.label}</b>
      {state.status === "pending" && <span> · signing and writing to Arkiv…</span>}
      {state.status === "done" && (
        <span>
          {" "}
          · written ✓
          {state.hash && backend.mode === "tiramisu" && (
            <>
              {" "}
              ·{" "}
              <a href={explorerTx(state.hash)} target="_blank" rel="noreferrer">
                transaction {shortHex(state.hash)}
              </a>
            </>
          )}
        </span>
      )}
      {state.status === "error" && <span> · {state.message}</span>}
    </p>
  )
}
