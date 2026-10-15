import { useCallback, useState } from "react"
import type { Hex } from "viem"

function errors(error: unknown): Error[] {
  const out: Error[] = []
  for (let cur: unknown = error; cur instanceof Error && out.length < 10; cur = (cur as { cause?: unknown }).cause) out.push(cur)
  return out
}

function causes(error: unknown): string[] {
  const out: string[] = []
  for (const e of errors(error) as Array<Error & { shortMessage?: string; details?: string }>) {
    for (const text of [e.message, e.shortMessage, e.details]) if (text) out.push(text)
  }
  return out
}

// What a person filling in a form should read. The SDK decodes engine reverts into a sentence ("Transaction failed:
// …"); an unfunded wallet surfaces only as "gas required exceeds: 0" several causes down, so that one is named here.
export function friendlyError(error: unknown): string {
  const quota = errors(error).find((e) => e.name === "ArkivQuotaError")
  if (quota) return `${quota.message} This page will read again after that.`
  const all = causes(error)
  const text = all.join("\n")
  if (/gas required exceeds|insufficient funds|exceeds the balance/i.test(text)) {
    return "This wallet has no test GLM yet. Press “Get test GLM”, then try again."
  }
  if (/HTTP request failed|Failed to fetch|fetch failed|NetworkError|WebSocket/i.test(text)) {
    return "Can’t reach Arkiv right now. Check your connection and try again."
  }
  const decoded = all.map((t) => t.split("\n")[0] ?? "").find((line) => line.startsWith("Transaction failed:") && !/without revert data/.test(line))
  if (decoded) return decoded.replace(/^Transaction failed:\s*/, "")
  const first = all[0]?.split("\n")[0]
  return first || String(error)
}

export type TxState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "done"; label: string; hash?: Hex }
  | { status: "error"; label: string; message: string }

export function useTx() {
  const [state, setState] = useState<TxState>({ status: "idle" })

  const run = useCallback(async (label: string, task: () => Promise<unknown>): Promise<boolean> => {
    setState({ status: "pending", label })
    try {
      const result = await task()
      const hash = (result as { txHash?: Hex } | undefined)?.txHash
      setState({ status: "done", label, ...(hash ? { hash } : {}) })
      return true
    } catch (error) {
      setState({ status: "error", label, message: friendlyError(error) })
      return false
    }
  }, [])

  return { state, busy: state.status === "pending", run }
}
