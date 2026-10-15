import { useCallback, useEffect, useState } from "react"
import { Link, useSearch } from "wouter"
import type { Hex } from "viem"
import { loadPledges, type PledgeView } from "../../core/consoles"
import { formatDuration } from "../../core/format"
import { loadNeed, type NeedView } from "../../core/queries"
import { n, s } from "../../core/records"
import { type Item, LIFETIME, MAX_QTY } from "../../core/schema"
import { cancelPledge, delayPledge, pledgeTo } from "../../core/writes"
import { VouchBadge } from "../components/Badge"
import { Countdown, useSecondsLeft } from "../components/Countdown"
import { GapMeter } from "../components/GapMeter"
import { ItemIcon } from "../components/ItemIcon"
import { TxStatus, WalletPanel } from "../components/WalletPanel"
import { useBackend } from "../lib/backend"
import { ITEM_LABELS, titleCase } from "../lib/labels"
import { useNowMs } from "../lib/ticker"
import { friendlyError } from "../lib/tx"
import { useBrowserWallet } from "../lib/wallet"
import { useWriter } from "../lib/writer"

const HOURS = [1, 2, 3, 6, 12, 24, 48] as const
const DELAY_HOURS = 2
const unixNow = () => Math.floor(Date.now() / 1000)

type Target = { view: NeedView; vouched: boolean; at: number }
type LiveTarget = Target & { view: Extract<NeedView, { state: "live" }> }

function PledgeForm({ target, busy, onSubmit }: { target: LiveTarget; busy: boolean; onSubmit: (x: { qty: number; hours: number; note: string }) => void }) {
  const { view } = target
  const seconds = useSecondsLeft(view.need.expiresAt, { block: view.block, fetchedAt: target.at })
  const item = s(view.need, "item") as Item
  const suggested = view.gap.gap > 0n ? view.gap.gap : 1n
  const [qty, setQty] = useState(String(suggested > BigInt(MAX_QTY) ? MAX_QTY : suggested))
  const [hours, setHours] = useState<number>(3)
  const [note, setNote] = useState("")
  return (
    <div className="pledge">
      <header className="mine__head">
        <ItemIcon item={item} className="tag__icon" />
        <div>
          <h2 className="tag__item">{ITEM_LABELS[item].en}</h2>
          <p className="tag__camp">
            {String(view.site.payload.name ?? "")} <VouchBadge vouched={target.vouched} />
          </p>
          <p className="tag__org">
            {titleCase(s(view.need, "district"))} · <Countdown seconds={seconds} /> left unless the camp confirms it again
          </p>
        </div>
      </header>
      <div className="tag__numbers">
        <p className="tag__short">
          <span className="tag__shortnum">{view.gap.gap.toString()}</span>
          <span className="tag__shortlabel">still short</span>
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
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit({ qty: Number(qty), hours, note: note.trim() })
        }}
      >
        <label className="field">
          <span className="field__label">I will deliver</span>
          <input className="field__input" type="number" required min={1} max={MAX_QTY} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Arriving in</span>
          <select className="field__input" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h} hour{h === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--wide">
          <span className="field__label">Note for the camp (optional, public)</span>
          <textarea maxLength={160} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. one truck from Dibrugarh" />
        </label>
        <p className="field__hint field--wide">
          Your pledge lowers the gap others see until {LIFETIME.pledgeGrace / 3600} h after the time you give. If you do not arrive, it lapses by itself and the gap reopens, so the camp is never left waiting on a promise
          nobody is keeping.
        </p>
        <div className="form__actions">
          <button className="btn btn--tarp" disabled={busy || view.gap.gap === 0n}>
            Pledge
          </button>
          {view.gap.gap === 0n && <span className="field__hint">This need is already fully promised.</span>}
        </div>
      </form>
    </div>
  )
}

function PledgeRow({ view, busy, onDelay, onCancel }: { view: PledgeView; busy: boolean; onDelay: (newEta: number) => void; onCancel: () => void }) {
  const nowMs = useNowMs()
  const now = Math.floor(nowMs / 1000)
  const item = s(view.pledge, "item") as Item
  const eta = Number(n(view.pledge, "eta"))
  const delayed = Math.max(eta, now) + DELAY_HOURS * 3600
  const canDelay = view.status === "open" && delayed <= now + LIFETIME.pledgeMaxHorizon
  const camp = String(view.site?.payload.name ?? "a camp")
  const status = { open: "Waiting for the camp", received: "Received by the camp ✓", "need gone": "Need closed or lapsed" }[view.status]
  return (
    <li className={`pledge-row pledge-row--${view.status.replace(" ", "-")}`}>
      <ItemIcon item={item} className="chip__icon" />
      <span>
        <b>{n(view.pledge, "qty").toString()}</b> {ITEM_LABELS[item].en.toLowerCase()} for {camp}
      </span>
      <span className="pledge-row__eta">{eta > now ? `arriving in ${formatDuration(eta - now)}` : `due ${formatDuration(now - eta)} ago`}</span>
      <span className="pledge-row__status">{status}</span>
      {view.status === "open" && (
        <span className="pledge-row__actions">
          <button type="button" className="btn btn--small btn--ghost" disabled={busy || !canDelay} onClick={() => onDelay(delayed)} title={canDelay ? "" : "A pledge can be at most 48 hours ahead."}>
            Running late: +{DELAY_HOURS} h
          </button>
          <button type="button" className="btn btn--small btn--ghost" disabled={busy} onClick={onCancel}>
            Withdraw
          </button>
        </span>
      )}
    </li>
  )
}

export default function Donor() {
  const backend = useBackend()
  const wallet = useBrowserWallet()
  const needKey = new URLSearchParams(useSearch()).get("need") as Hex | null
  const [target, setTarget] = useState<Target>()
  const [pledges, setPledges] = useState<PledgeView[]>()
  const [loadError, setLoadError] = useState<string>()

  const load = useCallback(async () => {
    try {
      const [view, mine] = await Promise.all([needKey ? loadNeed(backend.pub, needKey, undefined, backend.authorities) : undefined, loadPledges(backend.pub, wallet.address)])
      setPledges(mine.views)
      if (view) {
        setTarget({ view, vouched: view.state === "live" && view.vouched, at: Date.now() })
      } else {
        setTarget(undefined)
      }
      setLoadError(undefined)
      return mine.block
    } catch (error) {
      setLoadError(friendlyError(error))
      return undefined
    }
  }, [backend, needKey, wallet.address])

  useEffect(() => {
    void load()
  }, [load])

  const { tx, write } = useWriter(wallet, load)

  return (
    <section className="page console">
      <header className="console__head">
        <p className="kicker">For donors and relief groups</p>
        <h1 className="page__title">Promise what you can deliver</h1>
        <p className="page__lede">A pledge tells everyone the gap is being filled, so two trucks don’t race to the same camp while another waits. It is public, it carries your arrival time, and it lapses by itself if you never arrive.</p>
      </header>

      <WalletPanel wallet={wallet} role="Your donor" />
      <TxStatus state={tx.state} />
      {loadError && (
        <p className="note note--warn" role="alert">
          Could not read from Arkiv: {loadError}{" "}
          <button type="button" className="btn btn--small btn--ghost" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}

      {!needKey ? (
        <p className="note">
          Pick a need on the <Link href="/">board</Link> and press <b>Pledge</b>.
        </p>
      ) : !target ? (
        !loadError && <p className="verdict__checking">Checking the need on Arkiv…</p>
      ) : target.view.state === "live" ? (
        <PledgeForm
          target={target as LiveTarget}
          busy={tx.busy}
          onSubmit={(x) => {
            const view = (target as LiveTarget).view
            void write(`Pledging ${x.qty} ${ITEM_LABELS[s(view.need, "item") as Item].en.toLowerCase()}`, () =>
              pledgeTo(wallet.client, backend.pub, { need: view.need, qty: x.qty, etaUnix: unixNow() + x.hours * 3600, ...(x.note ? { note: x.note } : {}) }),
            )
          }}
        />
      ) : (
        <p className="note note--warn">
          This need is no longer live, so it cannot take pledges. <Link href={`/n/${needKey}`}>See why</Link> or go back to the <Link href="/">board</Link>.
        </p>
      )}

      <h2 className="console__h2">Your pledges</h2>
      {!pledges ? (
        <p className="verdict__checking">Reading your pledges…</p>
      ) : pledges.length === 0 ? (
        <p className="note">No live pledges from this wallet.</p>
      ) : (
        <ul className="pledge-list">
          {pledges.map((p) => (
            <PledgeRow
              key={p.pledge.key}
              view={p}
              busy={tx.busy}
              onDelay={(eta) => void write("Moving your arrival time", () => delayPledge(wallet.client, backend.pub, p.pledge, eta))}
              onCancel={() => void write("Withdrawing your pledge", () => cancelPledge(wallet.client, p.pledge.key))}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
