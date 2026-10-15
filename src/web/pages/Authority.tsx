import { useCallback, useEffect, useState } from "react"
import { explorerAddress } from "../../core/arkiv"
import { loadDirectory, type OrgRow } from "../../core/consoles"
import { secondsLeft } from "../../core/expiry"
import { formatDuration, shortHex } from "../../core/format"
import { s } from "../../core/records"
import { vouchFor, withdrawVouch } from "../../core/writes"
import { VouchBadge } from "../components/Badge"
import { TxStatus, WalletPanel } from "../components/WalletPanel"
import { useBackend } from "../lib/backend"
import { titleCase } from "../lib/labels"
import { useBoard } from "../lib/store"
import { friendlyError } from "../lib/tx"
import { useBrowserWallet } from "../lib/wallet"
import { useWriter } from "../lib/writer"

const ORG_TYPE: Record<string, string> = { govt: "Government", ngo: "NGO", volunteer: "Volunteer group" }

type Directory = { rows: OrgRow[]; block: bigint; truncated: boolean }

export default function Authority() {
  const backend = useBackend()
  const board = useBoard()
  const wallet = useBrowserWallet()
  const [district, setDistrict] = useState(board.district)
  const [draft, setDraft] = useState(titleCase(board.district))
  const [directory, setDirectory] = useState<Directory>()
  const [loadError, setLoadError] = useState<string>()
  const me = wallet.address.toLowerCase()
  const trusted = backend.authorities.some((a) => a.toLowerCase() === me)

  const load = useCallback(async () => {
    try {
      const found = await loadDirectory(backend.pub, district, wallet.address, backend.authorities)
      setDirectory(found)
      setLoadError(undefined)
      return found.block
    } catch (error) {
      setLoadError(friendlyError(error))
      return undefined
    }
  }, [backend, district, wallet.address])

  useEffect(() => {
    setDirectory(undefined)
    void load()
  }, [load])

  const { tx, write } = useWriter(wallet, load)

  return (
    <section className="page console">
      <header className="console__head">
        <p className="kicker">For district disaster management offices</p>
        <h1 className="page__title">Stand behind the camps you know</h1>
        <p className="page__lede">
          A vouch is a read-only Arkiv entity written by your office’s wallet. It cannot be edited or forged, it lapses after 30 days unless you vouch again, and you can withdraw it at any time. The board’s “Vouched only”
          view asks Arkiv for nothing but entities created by organisations that a trusted office vouched for.
        </p>
      </header>

      <WalletPanel wallet={wallet} role="Your office’s" />
      <p className={trusted ? "note" : "note note--warn"}>
        {trusted ? (
          <>This wallet is one of the authorities this site trusts, so your vouches change the “Vouched” badges for every viewer.</>
        ) : (
          <>
            Your vouches are real Arkiv entities, but this site’s badges only count vouches from{" "}
            {backend.authorities.map((a, i) => (
              <span key={a}>
                {i > 0 && ", "}
                {backend.mode === "tiramisu" ? (
                  <a href={explorerAddress(a)} target="_blank" rel="noreferrer">
                    {shortHex(a)}
                  </a>
                ) : (
                  shortHex(a)
                )}
              </span>
            ))}{" "}
            (the demo Dhemaji DDMA). Whoever reads this data chooses which authority wallets to trust; nobody, including us, can vouch on an office’s behalf.
          </>
        )}
      </p>
      <TxStatus state={tx.state} />

      <form
        className="controls controls--inline"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) setDistrict(draft.trim())
        }}
      >
        <label className="field">
          <span className="field__label">District</span>
          <input className="field__input" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <button className="btn btn--small">Show organisations</button>
      </form>

      {loadError && (
        <p className="note note--warn" role="alert">
          Could not read from Arkiv: {loadError}{" "}
          <button type="button" className="btn btn--small btn--ghost" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}

      {!directory ? (
        !loadError && <p className="verdict__checking">Reading organisations in {titleCase(district)}…</p>
      ) : directory.rows.length === 0 ? (
        <p className="note">No organisation has registered in {titleCase(district)}.</p>
      ) : (
        <div className="directory" role="table" aria-label={`Organisations registered in ${titleCase(district)}`}>
          <div className="directory__row directory__row--head" role="row">
            <span role="columnheader">Organisation</span>
            <span role="columnheader">Wallet</span>
            <span role="columnheader">On this site</span>
            <span role="columnheader">Your vouch</span>
          </div>
          {directory.rows.map((row) => {
            const name = String(row.org.payload.name ?? shortHex(row.org.creator))
            const self = row.org.creator === me
            return (
              <div key={row.org.key} className="directory__row" role="row">
                <span role="cell">
                  <b>{name}</b>
                  <span className="directory__meta">{ORG_TYPE[s(row.org, "org_type")] ?? s(row.org, "org_type")}</span>
                </span>
                <span role="cell" className="directory__wallet">
                  {backend.mode === "tiramisu" ? (
                    <a href={explorerAddress(row.org.creator)} target="_blank" rel="noreferrer">
                      {shortHex(row.org.creator)}
                    </a>
                  ) : (
                    shortHex(row.org.creator)
                  )}
                </span>
                <span role="cell">
                  {backend.authorities.some((a) => a.toLowerCase() === row.org.creator) ? (
                    <span className="badge badge--authority" title="A district authority wallet this site trusts. Its vouches decide the Vouched badges.">
                      Authority
                    </span>
                  ) : (
                    <VouchBadge vouched={row.vouchedByTrusted} />
                  )}
                </span>
                <span role="cell" className="directory__action">
                  {self ? (
                    <span className="directory__meta">This is you</span>
                  ) : row.myVouch ? (
                    <>
                      <span className="directory__meta">You vouched · {formatDuration(secondsLeft(row.myVouch.expiresAt, directory.block))} left</span>
                      <button type="button" className="btn btn--small btn--ghost" disabled={tx.busy} onClick={() => void write(`Withdrawing your vouch for ${name}`, () => withdrawVouch(wallet.client, row.myVouch!.key))}>
                        Withdraw
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--small btn--tarp" disabled={tx.busy} onClick={() => void write(`Vouching for ${name}`, () => vouchFor(wallet.client, { org: row.org.creator, district }))}>
                      Vouch
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {directory?.truncated && <p className="note note--warn">Some organisations were cut off by the result limit.</p>}
    </section>
  )
}
