export function VouchBadge({ vouched }: { vouched: boolean }) {
  return vouched ? (
    <span className="badge badge--vouched" title="A district authority you trust has vouched for this organisation. The vouch is an Arkiv entity created by their wallet and it lapses after 30 days.">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M2.5 8.5 6.2 12 13.5 4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
      </svg>
      Vouched
    </span>
  ) : (
    <span className="badge badge--open" title="No authority you trust has vouched for this organisation. Anyone can write needs to Arkiv, so treat unverified ones with care.">
      Unverified
    </span>
  )
}

export function Stamp({ children, tone = "danger" }: { children: string; tone?: "danger" | "ok" }) {
  return (
    <div className={`stamp stamp--${tone}`} role="status">
      <span>{children}</span>
    </div>
  )
}
