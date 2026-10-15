import { formatDuration } from "../../core/format"
import { type Snap, secondsUntil } from "../lib/chainTime"
import { useNowMs } from "../lib/ticker"

export function useSecondsLeft(expiresAt: bigint, snap: Snap): number {
  return secondsUntil(expiresAt, snap, useNowMs())
}

export function Countdown({ seconds, className }: { seconds: number; className?: string }) {
  return (
    <time className={`countdown ${className ?? ""}`} dateTime={`PT${seconds}S`}>
      {formatDuration(seconds)}
    </time>
  )
}

// A fuse that burns down in real time: the whole point of the product is that a need only stays if its camp keeps
// confirming it, so the time left is shown as something visibly running out.
export function Fuse({ seconds, total }: { seconds: number; total: number }) {
  const fraction = total > 0 ? Math.min(1, seconds / total) : 0
  const tone = fraction > 0.5 ? "calm" : fraction > 0.2 ? "warn" : "critical"
  const percent = `${(fraction * 100).toFixed(2)}%`
  return (
    <div
      className={`fuse fuse--${tone}`}
      role="progressbar"
      aria-label="Time before this need lapses unless the camp confirms it again"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
    >
      <div className="fuse__burn" style={{ width: percent }} />
      <span className="fuse__spark" style={{ left: percent }} aria-hidden="true" />
    </div>
  )
}
