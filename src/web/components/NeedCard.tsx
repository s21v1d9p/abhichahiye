import { type CSSProperties, useState } from "react"
import { Link } from "wouter"
import type { Snap } from "../lib/chainTime"
import { ITEM_LABELS, urgencyLabel } from "../lib/labels"
import { needUrl, shareMessage } from "../lib/share"
import type { NeedRow } from "../lib/store"
import { VouchBadge, Stamp } from "./Badge"
import { Countdown, Fuse, useSecondsLeft } from "./Countdown"
import { GapMeter } from "./GapMeter"
import { ItemIcon } from "./ItemIcon"

export function ShareButton({ row, seconds, district }: { row: NeedRow; seconds: number; district: string }) {
  const [state, setState] = useState<"idle" | "copied">("idle")
  const onClick = async () => {
    const text = shareMessage({
      item: row.item,
      camp: row.campName,
      district,
      qty: row.gap.qty,
      pledged: row.gap.pledged,
      gap: row.gap.gap,
      secondsLeft: seconds,
      url: needUrl(row.key),
    })
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text })
      } else {
        await navigator.clipboard.writeText(text)
        setState("copied")
        setTimeout(() => setState("idle"), 2200)
      }
    } catch {
      // The person closed the share sheet; nothing to do.
    }
  }
  return (
    <button type="button" className="btn btn--small btn--ghost" onClick={onClick}>
      {state === "copied" ? "Copied for WhatsApp ✓" : "Share"}
    </button>
  )
}

export function NeedCard({ row, snap, district, index }: { row: NeedRow; snap: Snap; district: string; index: number }) {
  const seconds = useSecondsLeft(row.gap.need.expiresAt, snap)
  const labels = ITEM_LABELS[row.item]
  const urgency = urgencyLabel(row.urgency)
  const expired = seconds === 0
  const critical = !expired && (seconds < 900 || seconds / row.lifetime < 0.1)
  const covered = row.gap.gap === 0n

  return (
    <article
      className={`tag tag--u${row.urgency}${expired ? " is-expired" : ""}${critical ? " is-critical" : ""}${covered ? " is-covered" : ""}`}
      style={{ "--i": index } as CSSProperties}
      aria-label={`${labels.en} needed at ${row.campName}`}
    >
      <header className="tag__head">
        <ItemIcon item={row.item} className="tag__icon" />
        <div className="tag__titles">
          <h3 className="tag__item">{labels.en}</h3>
          <p className="tag__indic">
            <span lang="hi">{labels.hi}</span>
            <span aria-hidden="true"> · </span>
            <span lang="as">{labels.as}</span>
          </p>
        </div>
        <span className="tag__urgency" title={`${urgency.en}. ${urgency.hi}`}>
          {urgency.short}
        </span>
      </header>

      <p className="tag__camp">
        <span className="tag__campname">{row.campName}</span>
        <VouchBadge vouched={row.vouched} />
      </p>
      <p className="tag__org">Confirmed by {row.orgName}</p>

      <div className="tag__numbers">
        <p className="tag__short">
          <span className="tag__shortnum">{row.gap.gap.toString()}</span>
          <span className="tag__shortlabel">{covered ? "fully promised" : "still short"}</span>
        </p>
        <dl className="tag__facts">
          <div>
            <dt>asked</dt>
            <dd>{row.gap.qty.toString()}</dd>
          </div>
          <div>
            <dt>promised</dt>
            <dd>{row.gap.pledged.toString()}</dd>
          </div>
        </dl>
      </div>
      <GapMeter qty={row.gap.qty} pledged={row.gap.pledged} />

      {row.note && <p className="tag__note">“{row.note}”</p>}

      <footer className="tag__foot">
        <p className="tag__clock">
          <Countdown seconds={seconds} />
          <span> left unless the camp confirms it again</span>
        </p>
        <Fuse seconds={seconds} total={row.lifetime} />
        <div className="tag__actions">
          <Link href={`/donate?need=${row.key}`} className="btn btn--small">
            Pledge
          </Link>
          <ShareButton row={row} seconds={seconds} district={district} />
          <Link href={`/n/${row.key}`} className="btn btn--small btn--ghost">
            Open
          </Link>
        </div>
      </footer>

      {expired && <Stamp>Expired</Stamp>}
    </article>
  )
}
