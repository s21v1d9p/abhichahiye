import { type ReactNode, useCallback, useEffect, useState } from "react"
import { Link } from "wouter"
import { type CampView, type LiveNeed, loadCamp } from "../../core/consoles"
import { secondsLeft } from "../../core/expiry"
import { formatDuration, shortHex } from "../../core/format"
import { n, type Rec, s } from "../../core/records"
import { ITEMS, type Item, LIFETIME, MAX_QTY, ORG_TYPES, type OrgType, SITE_TYPES, type SiteType, type Urgency } from "../../core/schema"
import { createSite, postNeed, reconfirmNeed, recordReceipt, registerOrg } from "../../core/writes"
import { Countdown, Fuse, useSecondsLeft } from "../components/Countdown"
import { GapMeter } from "../components/GapMeter"
import { ItemIcon } from "../components/ItemIcon"
import { TxStatus, WalletPanel } from "../components/WalletPanel"
import { useBackend } from "../lib/backend"
import { INDIAN_STATES } from "../lib/config"
import { ITEM_LABELS, asUrgency, titleCase, urgencyLabel } from "../lib/labels"
import { useBoard } from "../lib/store"
import { useNowMs } from "../lib/ticker"
import { friendlyError } from "../lib/tx"
import { useBrowserWallet } from "../lib/wallet"
import { useWriter } from "../lib/writer"

const ORG_TYPE_LABEL: Record<OrgType, string> = { govt: "Government", ngo: "NGO", volunteer: "Volunteer group" }
const SITE_TYPE_LABEL: Record<SiteType, string> = { camp: "Relief camp", collection: "Collection point", kitchen: "Community kitchen" }

function Step({ index, title, done, locked, children }: { index: number; title: string; done?: ReactNode; locked?: string; children?: ReactNode }) {
  return (
    <li className={`step${done ? " step--done" : ""}${locked ? " step--locked" : ""}`}>
      <span className="step__num" aria-hidden="true">
        {done ? "✓" : index}
      </span>
      <div className="step__body">
        <h2 className="step__title">{title}</h2>
        {done ? <div className="step__done">{done}</div> : locked ? <p className="step__locked">{locked}</p> : children}
      </div>
    </li>
  )
}

type OrgInput = { name: string; orgType: OrgType; helpline: string; state: string; district: string }

function OrgForm({ busy, district, onSubmit }: { busy: boolean; district: string; onSubmit: (o: OrgInput) => void }) {
  const [o, setO] = useState<OrgInput>({ name: "", orgType: "ngo", helpline: "", state: "AS", district: titleCase(district) })
  const set = (patch: Partial<OrgInput>) => setO((prev) => ({ ...prev, ...patch }))
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ ...o, name: o.name.trim(), helpline: o.helpline.trim(), district: o.district.trim() })
      }}
    >
      <label className="field field--wide">
        <span className="field__label">Organisation name</span>
        <input className="field__input" required maxLength={80} value={o.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Silapathar Camp Committee" />
      </label>
      <label className="field">
        <span className="field__label">Type</span>
        <select className="field__input" value={o.orgType} onChange={(e) => set({ orgType: e.target.value as OrgType })}>
          {ORG_TYPES.map((t) => (
            <option key={t} value={t}>
              {ORG_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">Public helpline (optional)</span>
        <input className="field__input" maxLength={20} value={o.helpline} onChange={(e) => set({ helpline: e.target.value })} placeholder="e.g. 1077" />
        <span className="field__hint">Official numbers only. Personal mobile numbers are refused.</span>
      </label>
      <label className="field">
        <span className="field__label">State</span>
        <select className="field__input" value={o.state} onChange={(e) => set({ state: e.target.value })}>
          {INDIAN_STATES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">District</span>
        <input className="field__input" required maxLength={60} value={o.district} onChange={(e) => set({ district: e.target.value })} />
      </label>
      <div className="form__actions">
        <button className="btn" disabled={busy}>
          Register organisation
        </button>
      </div>
    </form>
  )
}

type SiteInput = { name: string; landmark: string; siteType: SiteType; people: string; lat: string; lng: string; district: string }

function SiteForm({ busy, org, onSubmit }: { busy: boolean; org: Rec; onSubmit: (x: SiteInput) => void }) {
  const [x, setX] = useState<SiteInput>({ name: "", landmark: "", siteType: "camp", people: "100", lat: "", lng: "", district: titleCase(s(org, "district")) })
  const [geo, setGeo] = useState<string>()
  const set = (patch: Partial<SiteInput>) => setX((prev) => ({ ...prev, ...patch }))
  const locate = () => {
    if (!navigator.geolocation) return setGeo("This browser cannot share its location. Type the coordinates instead.")
    setGeo("Finding you…")
    navigator.geolocation.getCurrentPosition(
      (p) => {
        set({ lat: p.coords.latitude.toFixed(5), lng: p.coords.longitude.toFixed(5) })
        setGeo(undefined)
      },
      () => setGeo("Location was not shared. Type the coordinates instead."),
      { enableHighAccuracy: true, timeout: 15_000 },
    )
  }
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ ...x, name: x.name.trim(), landmark: x.landmark.trim(), district: x.district.trim() })
      }}
    >
      <label className="field field--wide">
        <span className="field__label">Camp name</span>
        <input className="field__input" required maxLength={80} value={x.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Silapathar relief camp" />
      </label>
      <label className="field">
        <span className="field__label">Kind of site</span>
        <select className="field__input" value={x.siteType} onChange={(e) => set({ siteType: e.target.value as SiteType })}>
          {SITE_TYPES.map((t) => (
            <option key={t} value={t}>
              {SITE_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">People sheltering</span>
        <input className="field__input" type="number" required min={1} max={MAX_QTY} step={1} value={x.people} onChange={(e) => set({ people: e.target.value })} />
      </label>
      <label className="field field--wide">
        <span className="field__label">Public landmark (optional)</span>
        <input className="field__input" maxLength={100} value={x.landmark} onChange={(e) => set({ landmark: e.target.value })} placeholder="e.g. Government HS school ground" />
        <span className="field__hint">Only public sites. Never a family’s home.</span>
      </label>
      <label className="field">
        <span className="field__label">District</span>
        <input className="field__input" required maxLength={60} value={x.district} onChange={(e) => set({ district: e.target.value })} />
      </label>
      <label className="field">
        <span className="field__label">Latitude</span>
        <input className="field__input" type="number" required min={6} max={37.5} step="any" value={x.lat} onChange={(e) => set({ lat: e.target.value })} placeholder="27.59400" />
      </label>
      <label className="field">
        <span className="field__label">Longitude</span>
        <input className="field__input" type="number" required min={68} max={97.5} step="any" value={x.lng} onChange={(e) => set({ lng: e.target.value })} placeholder="94.72300" />
      </label>
      <div className="form__actions">
        <button type="button" className="btn btn--ghost btn--small" onClick={locate}>
          Use my location
        </button>
        {geo && <span className="field__hint">{geo}</span>}
        <button className="btn" disabled={busy}>
          List this camp
        </button>
      </div>
    </form>
  )
}

type NeedInput = { item: Item; qty: string; urgency: Urgency; note: string }

function NeedForm({ busy, onSubmit }: { busy: boolean; onSubmit: (x: NeedInput) => Promise<boolean> }) {
  const [x, setX] = useState<NeedInput>({ item: "water", qty: "100", urgency: 2, note: "" })
  const set = (patch: Partial<NeedInput>) => setX((prev) => ({ ...prev, ...patch }))
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (await onSubmit({ ...x, note: x.note.trim() })) set({ note: "" })
      }}
    >
      <fieldset className="pick">
        <legend className="field__label">What do you need?</legend>
        {ITEMS.map((item) => (
          <label key={item} className="pick__opt">
            <input type="radio" name="item" value={item} checked={x.item === item} onChange={() => set({ item })} />
            <ItemIcon item={item} className="pick__icon" />
            <span className="pick__en">{ITEM_LABELS[item].en}</span>
            <span className="pick__hi" lang="hi">
              {ITEM_LABELS[item].hi}
            </span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span className="field__label">How many</span>
        <input className="field__input" type="number" required min={1} max={MAX_QTY} step={1} value={x.qty} onChange={(e) => set({ qty: e.target.value })} />
      </label>
      <fieldset className="urgency">
        <legend className="field__label">How urgent</legend>
        {([3, 2, 1] as const).map((u) => (
          <label key={u} className={`urgency__opt urgency__opt--u${u}`}>
            <input type="radio" name="urgency" checked={x.urgency === u} onChange={() => set({ urgency: u })} />
            <b>{urgencyLabel(u).short}</b>
            <span>Disappears after {LIFETIME.need[u] / 3600} h unless you confirm it again</span>
          </label>
        ))}
      </fieldset>
      <label className="field field--wide">
        <span className="field__label">Note (optional, public)</span>
        <textarea maxLength={160} value={x.note} onChange={(e) => set({ note: e.target.value })} placeholder="Sizes, kind, where to unload" />
        <span className="field__hint">Everything here is public on Arkiv. No names, no phone numbers.</span>
      </label>
      <div className="form__actions">
        <button className="btn btn--tarp" disabled={busy}>
          Post this need
        </button>
      </div>
    </form>
  )
}

function etaText(etaUnix: bigint, nowMs: number) {
  const delta = Number(etaUnix) - Math.floor(nowMs / 1000)
  return delta > 0 ? `arriving in ${formatDuration(delta)}` : `due ${formatDuration(-delta)} ago`
}

function MyNeed({ view, loadedAt, busy, onConfirm, onReceived }: { view: LiveNeed; loadedAt: number; busy: boolean; onConfirm: () => void; onReceived: (pledge: Rec) => void }) {
  const seconds = useSecondsLeft(view.need.expiresAt, { block: view.block, fetchedAt: loadedAt })
  const nowMs = useNowMs()
  const item = s(view.need, "item") as Item
  const urgency = asUrgency(n(view.need, "urgency"))
  return (
    <article className={`mine tag--u${urgency}`}>
      <header className="mine__head">
        <ItemIcon item={item} className="tag__icon" />
        <div>
          <h3 className="tag__item">{ITEM_LABELS[item].en}</h3>
          <p className="tag__org">{urgencyLabel(urgency).en}</p>
        </div>
        <Link href={`/n/${view.need.key}`} className="backlink">
          Public page →
        </Link>
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
      <p className="tag__clock">
        <Countdown seconds={seconds} />
        <span>left. Confirm it again while you still need it.</span>
      </p>
      <Fuse seconds={seconds} total={LIFETIME.need[urgency]} />
      <div className="tag__actions">
        <button type="button" className="btn btn--small" disabled={busy || seconds === 0} onClick={onConfirm}>
          Still needed: confirm again
        </button>
      </div>
      {view.gap.openPledges.length > 0 && (
        <div className="mine__pledges">
          <p className="field__label">Promised by donors</p>
          <ul>
            {view.gap.openPledges.map((p) => (
              <li key={p.key} className="pledge-row">
                <b>{n(p, "qty").toString()}</b>
                <span>from {shortHex(p.creator)}</span>
                <span className="pledge-row__eta">{etaText(n(p, "eta"), nowMs)}</span>
                <button type="button" className="btn btn--small btn--tarp" disabled={busy} onClick={() => onReceived(p)}>
                  Received
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}

export default function Camp() {
  const backend = useBackend()
  const { district } = useBoard()
  const wallet = useBrowserWallet()
  const [view, setView] = useState<CampView & { at: number }>()
  const [loadError, setLoadError] = useState<string>()

  const load = useCallback(async () => {
    try {
      const camp = await loadCamp(backend.pub, wallet.address)
      setView({ ...camp, at: Date.now() })
      setLoadError(undefined)
      return camp.block
    } catch (error) {
      setLoadError(friendlyError(error))
      return undefined
    }
  }, [backend, wallet.address])

  useEffect(() => {
    void load()
  }, [load])

  const { tx, write } = useWriter(wallet, load)
  const org = view?.org
  const site = view?.site

  return (
    <section className="page console">
      <header className="console__head">
        <p className="kicker">For camp coordinators</p>
        <h1 className="page__title">Post what your camp needs</h1>
        <p className="page__lede">
          Each need stays on the board only while you keep confirming it. If you stop, it disappears by itself, so nobody ever forwards a list that is days old. Every step below is one Arkiv transaction signed by your
          browser’s test wallet.
        </p>
      </header>

      <WalletPanel wallet={wallet} role="Your camp’s" />
      <TxStatus state={tx.state} />
      {loadError && (
        <p className="note note--warn" role="alert">
          Could not read your camp from Arkiv: {loadError}{" "}
          <button type="button" className="btn btn--small btn--ghost" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}

      {!view ? (
        <p className="verdict__checking">Reading your camp from Arkiv…</p>
      ) : (
        <>
          <ol className="steps">
            <Step
              index={1}
              title="Your organisation"
              done={
                org && (
                  <>
                    <b>{String(org.payload.name)}</b> · {titleCase(s(org, "district"))} · registration renewed whenever you post, {formatDuration(secondsLeft(org.expiresAt, view.block))} left
                  </>
                )
              }
            >
              <OrgForm
                busy={tx.busy}
                district={district}
                onSubmit={(o) =>
                  void write("Registering your organisation", () =>
                    registerOrg(wallet.client, { name: o.name, helpline: o.helpline, orgType: o.orgType, state: o.state, district: o.district }),
                  )
                }
              />
            </Step>
            <Step
              index={2}
              title="Your camp"
              locked={org ? undefined : "Register your organisation first."}
              done={
                site && (
                  <>
                    <b>{String(site.payload.name)}</b> · {titleCase(s(site, "district"))} · {n(site, "people").toString()} people · listing renewed whenever you post, {formatDuration(secondsLeft(site.expiresAt, view.block))} left
                  </>
                )
              }
            >
              {org && (
                <SiteForm
                  busy={tx.busy}
                  org={org}
                  onSubmit={(x) =>
                    void write("Listing your camp", () =>
                      createSite(wallet.client, {
                        name: x.name,
                        landmark: x.landmark,
                        siteType: x.siteType,
                        state: s(org, "state").toUpperCase(),
                        district: x.district,
                        lat: Number(x.lat),
                        lng: Number(x.lng),
                        people: Number(x.people),
                      }),
                    )
                  }
                />
              )}
            </Step>
            <Step index={3} title="Post a need" locked={site ? undefined : "List your camp first."}>
              {site && (
                <NeedForm
                  busy={tx.busy}
                  onSubmit={(x) =>
                    write(`Posting ${x.qty} ${ITEM_LABELS[x.item].en.toLowerCase()}`, () =>
                      postNeed(wallet.client, backend.pub, { site, ...(org ? { orgKey: org.key } : {}), item: x.item, qty: Number(x.qty), urgency: x.urgency, ...(x.note ? { note: x.note } : {}) }),
                    )
                  }
                />
              )}
            </Step>
          </ol>

          <h2 className="console__h2">Your live needs</h2>
          {view.truncated && <p className="note note--warn">Some of your entities or their pledges were cut off by the result limit, so this list and its counts may be incomplete.</p>}
          {view.needs.length === 0 ? (
            <p className="note">Nothing is live. Needs you post appear here with the time left before they lapse.</p>
          ) : (
            <div className="mine__list">
              {view.needs.map((v) => (
                <MyNeed
                  key={v.need.key}
                  view={v}
                  loadedAt={view.at}
                  busy={tx.busy}
                  onConfirm={() => void write(`Confirming ${ITEM_LABELS[s(v.need, "item") as Item].en.toLowerCase()} again`, () => reconfirmNeed(wallet.client, backend.pub, v.need, org?.key))}
                  onReceived={(pledge) => void write(`Recording ${n(pledge, "qty")} received`, () => recordReceipt(wallet.client, backend.pub, { pledge, need: v.need }))}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
