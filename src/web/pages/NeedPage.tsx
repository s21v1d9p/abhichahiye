import { useCallback, useEffect, useState } from "react"
import { Link } from "wouter"
import type { Hex } from "viem"
import { explorerAddress } from "../../core/arkiv"
import { formatDuration, shortHex } from "../../core/format"
import { loadNeed, type NeedView } from "../../core/queries"
import { n, s } from "../../core/records"
import type { Item } from "../../core/schema"
import { Stamp, VouchBadge } from "../components/Badge"
import { Countdown, Fuse, useSecondsLeft } from "../components/Countdown"
import { GapMeter } from "../components/GapMeter"
import { ItemIcon } from "../components/ItemIcon"
import { useBackend } from "../lib/backend"
import type { Snap } from "../lib/chainTime"
import { ITEM_LABELS, asUrgency, urgencyLabel } from "../lib/labels"
import { needUrl, shareMessage, whatsappLink } from "../lib/share"
import { useBoard } from "../lib/store"
import { useLiveEvents } from "../lib/live"
import { friendlyError } from "../lib/tx"
import { LIFETIME } from "../../core/schema"

type Loaded = { view: NeedView; fetchedAt: number; vouched: boolean; orgName: string }
// Live events refresh the page when anything about this need changes; this is the safety net (two queries each).
const POLL_MS = 60_000

const DEAD = {
  gone: {
    stamp: "Expired",
    title: "This need is no longer confirmed.",
    body: "The camp did not confirm it again in time, or it has been fulfilled. Please do not forward it or load a vehicle for it.",
  },
  foreign: {
    stamp: "Not a need",
    title: "This link does not point to an AbhiChahiye need.",
    body: "It is something else stored on Arkiv. Do not forward it as a relief request.",
  },
  orphan: {
    stamp: "Camp gone",
    title: "The camp listing behind this need has expired.",
    body: "Nobody is confirming that this camp is still there. Please do not forward it.",
  },
  forged: {
    stamp: "Not from the camp",
    title: "This post was not written by the camp it names.",
    body: "It points at a real camp, but a different wallet wrote it. Anyone can write to Arkiv, so authorship decides: ignore this and do not forward it.",
  },
} as const

function Dead({ kind }: { kind: keyof typeof DEAD }) {
  const d = DEAD[kind]
  return (
    <div className="verdict verdict--dead">
      <Stamp>{d.stamp}</Stamp>
      <h1 className="verdict__title">{d.title}</h1>
      <p className="verdict__body">{d.body}</p>
      <p className="verdict__alert">Don’t forward.</p>
      <div className="verdict__actions">
        <Link href="/" className="btn">
          See what is needed now
        </Link>
      </div>
    </div>
  )
}

function Live({ loaded, needKey }: { loaded: Loaded; needKey: string }) {
  const { district: boardDistrict, setDistrict } = useBoard()
  const view = loaded.view as Extract<NeedView, { state: "live" }>
  const snap: Snap = { block: view.block, fetchedAt: loaded.fetchedAt }
  const seconds = useSecondsLeft(view.need.expiresAt, snap)
  const item = s(view.need, "item") as Item
  const labels = ITEM_LABELS[item]
  const urgency = asUrgency(n(view.need, "urgency"))
  const district = s(view.need, "district")
  const campName = String(view.site.payload.name ?? shortHex(view.site.key))
  const [copied, setCopied] = useState(false)

  if (seconds === 0) return <Dead kind="gone" />

  const message = shareMessage({
    item,
    camp: campName,
    district,
    qty: view.gap.qty,
    pledged: view.gap.pledged,
    gap: view.gap.gap,
    secondsLeft: seconds,
    url: needUrl(needKey),
  })

  return (
    <div className="verdict verdict--live">
      <p className="verdict__flag">
        <span className="dot dot--live" aria-hidden="true" />
        Live · confirmed by the camp
      </p>
      <header className="verdict__head">
        <ItemIcon item={item} className="verdict__icon" />
        <div>
          <h1 className="verdict__item">{labels.en}</h1>
          <p className="tag__indic">
            <span lang="hi">{labels.hi}</span> · <span lang="as">{labels.as}</span>
          </p>
        </div>
      </header>

      <p className="verdict__camp">
        {campName} <VouchBadge vouched={loaded.vouched} />
      </p>
      <p className="tag__org">
        {district.replaceAll("_", " ")} · {urgencyLabel(urgency).en}
      </p>

      <div className="verdict__numbers">
        <p className="tag__short tag__short--xl">
          <span className="tag__shortnum">{view.gap.gap.toString()}</span>
          <span className="tag__shortlabel">{view.gap.gap === 0n ? "fully promised" : "still short"}</span>
        </p>
        <dl className="tag__facts">
          <div>
            <dt>asked</dt>
            <dd>{view.gap.qty.toString()}</dd>
          </div>
          <div>
            <dt>promised</dt>
            <dd>{view.gap.pledged.toString()}</dd>
          </div>
        </dl>
      </div>
      <GapMeter qty={view.gap.qty} pledged={view.gap.pledged} />
      {typeof view.need.payload.note === "string" && view.need.payload.note && <p className="tag__note">“{view.need.payload.note}”</p>}
      {view.truncated && <p className="note note--warn">More entities name this need than one read returns, so the promised count may be incomplete.</p>}

      <div className="verdict__clock">
        <Countdown seconds={seconds} className="countdown--xl" />
        <span>left unless the camp confirms it again</span>
      </div>
      <Fuse seconds={seconds} total={LIFETIME.need[urgency]} />

      <div className="verdict__actions">
        <a className="btn" href={whatsappLink(message)} target="_blank" rel="noreferrer">
          Share on WhatsApp
        </a>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(message)
            setCopied(true)
            setTimeout(() => setCopied(false), 2200)
          }}
        >
          {copied ? "Copied ✓" : "Copy message"}
        </button>
        <Link href={`/donate?need=${view.need.key}`} className="btn btn--tarp">
          I can send this
        </Link>
        <Link href="/" className="btn btn--ghost" onClick={() => district !== boardDistrict && setDistrict(district)}>
          All needs in {district.replaceAll("_", " ")}
        </Link>
      </div>

      <details className="proof">
        <summary>How do I know this is real?</summary>
        <dl className="proof__list">
          <div>
            <dt>Written by</dt>
            <dd>
              <a href={explorerAddress(view.need.creator)} target="_blank" rel="noreferrer">
                {view.need.creator}
              </a>
              , the same wallet that created the camp listing. Anyone can write to Arkiv; only the creator of an entity cannot be faked, so that is what is checked.
            </dd>
          </div>
          <div>
            <dt>Need entity</dt>
            <dd>
              <code>{view.need.key}</code>
            </dd>
          </div>
          <div>
            <dt>Check without this website</dt>
            <dd>
              <code>npm run abhi -- need {view.need.key}</code>
            </dd>
          </div>
        </dl>
      </details>
    </div>
  )
}

export default function NeedPage({ needKey }: { needKey: string }) {
  const backend = useBackend()
  const [loaded, setLoaded] = useState<Loaded>()
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    try {
      const view = await loadNeed(backend.pub, needKey as Hex, undefined, backend.authorities)
      setLoaded({ view, fetchedAt: Date.now(), vouched: view.state === "live" && view.vouched, orgName: view.state === "live" ? view.orgName : "" })
      setError(undefined)
    } catch (e) {
      setError(friendlyError(e))
    }
  }, [backend, needKey])

  useEffect(() => {
    setLoaded(undefined)
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  // Re-read as soon as the need itself changes, or its camp writes anything (a re-confirmation, a receipt).
  const camp = loaded?.view.state === "live" ? loaded.view.need.creator : undefined
  useLiveEvents(backend, (key, owner) => key === needKey.toLowerCase() || (owner !== undefined && owner === camp), () => void load())

  return (
    <section className="verdict-wrap">
      <Link href="/" className="backlink">
        ← All needs
      </Link>
      {error && !loaded && (
        <div className="alert" role="alert">
          <b>Can’t reach Arkiv, so this link could not be checked.</b> Do not forward it until it can. <span className="alert__detail">{error}</span>
          <button type="button" className="btn btn--small" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {!loaded && !error && <p className="verdict__checking">Checking Arkiv…</p>}
      {loaded && (loaded.view.state === "live" ? <Live loaded={loaded} needKey={needKey} /> : <Dead kind={loaded.view.state} />)}
      {loaded && error && <p className="note note--warn">Could not refresh just now ({error}). Showing the last check from {formatDuration(Math.round((Date.now() - loaded.fetchedAt) / 1000))} ago.</p>}
    </section>
  )
}
