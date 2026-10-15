import { lazy, Suspense, useState } from "react"
import { Link } from "wouter"
import { formatDuration } from "../../core/format"
import { NeedCard } from "../components/NeedCard"
import { Controls } from "../components/Controls"
import { useBoard, type NeedRow } from "../lib/store"
import { type Snap } from "../lib/chainTime"
import { useNowMs } from "../lib/ticker"

const MapPane = lazy(() => import("../components/MapPane"))

// A card stays on screen, stamped, for a few seconds after its time runs out, then the next refresh drops it for good.
const isGone = (row: NeedRow, snap: Snap, nowMs: number) =>
  (nowMs - snap.fetchedAt) / 1000 - Number(row.gap.need.expiresAt - snap.block) * 2 > 5

function StatusStrip() {
  const { snap, live, status, refresh, filters } = useBoard()
  const nowMs = useNowMs()
  const age = snap ? Math.max(0, Math.round((nowMs - snap.fetchedAt) / 1000)) : undefined
  return (
    <p className="status" role="status">
      <span className={live ? "dot dot--live" : "dot"} aria-hidden="true" />
      <span className="status__live">{live ? "Live" : "Polling"}</span>
      {snap && (
        <>
          <span className="status__sep">·</span>
          <span>block {snap.block.toLocaleString("en-IN")}</span>
          <span className="status__sep">·</span>
          <span>{age === 0 ? "just now" : `${formatDuration(age ?? 0)} ago`}</span>
        </>
      )}
      <span className="status__sep">·</span>
      <span>{filters.view === "verified" ? "vouched organisations only" : "everyone"}</span>
      <button type="button" className="status__refresh" onClick={refresh} disabled={status === "loading"}>
        Refresh
      </button>
    </p>
  )
}

function Skeleton() {
  return (
    <div className="board__list" aria-busy="true" aria-label="Loading needs from Arkiv">
      {[0, 1, 2].map((i) => (
        <div key={i} className="tag tag--skeleton" style={{ "--i": i } as React.CSSProperties} />
      ))}
    </div>
  )
}

function Empty() {
  const { filters, setFilters, district } = useBoard()
  return (
    <div className="empty">
      <p className="empty__title">Nothing is confirmed right now</p>
      <p className="empty__body">
        No camp in <b>{district}</b> has a live need that matches these filters. That is a real answer, not an error: a need disappears from Arkiv by itself when its camp stops confirming it, so nothing stale
        is waiting here.
      </p>
      <div className="empty__actions">
        <Link href="/camp" className="btn">
          I run a camp: post a need
        </Link>
        {(filters.minUrgency > 1 || filters.item !== "all") && (
          <button type="button" className="btn btn--ghost" onClick={() => setFilters({ minUrgency: 1, item: "all" })}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}

export default function Board() {
  const { status, rows, snap, rejected, error, district, snapshot, filters, refresh } = useBoard()
  const [pane, setPane] = useState<"list" | "map">("list")
  const nowMs = useNowMs()
  const visible = snap ? rows.filter((row) => !isGone(row, snap, nowMs)) : []
  const campCount = new Set(visible.map((r) => r.siteKey)).size

  return (
    <section className="board">
      <div className="hero">
        <h1 className="hero__title">
          What every camp needs <em>right now</em>
        </h1>
        <p className="hero__lede">
          A need stays on this board only while its camp keeps confirming it. Stop confirming and it vanishes by itself, so a stale list is never forwarded. Every number below is read straight from Arkiv.
        </p>
        <dl className="hero__legend">
          <div>
            <dt>
              <i className="legend__fuse" aria-hidden="true" />
              Fuse
            </dt>
            <dd>time before the need lapses</dd>
          </div>
          <div>
            <dt>
              <i className="legend__meter" aria-hidden="true" />
              Bar
            </dt>
            <dd>green is already promised</dd>
          </div>
          <div>
            <dt>
              <i className="legend__badge" aria-hidden="true" />
              Vouched
            </dt>
            <dd>a district authority stands behind the camp</dd>
          </div>
        </dl>
      </div>

      <Controls />
      <StatusStrip />

      {error && status === "error" && (
        <div className="alert" role="alert">
          <b>Can’t reach Arkiv.</b> {snapshot ? `Showing what was read at ${new Date(snapshot.fetchedAt).toLocaleTimeString("en-IN")}; it is not being refreshed.` : "Nothing has been loaded yet."}{" "}
          <span className="alert__detail">{error}</span>
          <button type="button" className="btn btn--small" onClick={refresh}>
            Try again
          </button>
        </div>
      )}

      <div className="board__switch" role="tablist" aria-label="Show">
        <button type="button" role="tab" aria-selected={pane === "list"} onClick={() => setPane("list")}>
          Needs {visible.length > 0 && <span>({visible.length})</span>}
        </button>
        <button type="button" role="tab" aria-selected={pane === "map"} onClick={() => setPane("map")}>
          Map
        </button>
      </div>

      <div className="board__body">
        <div className={`board__col board__col--list${pane === "list" ? " is-active" : ""}`}>
          {status === "loading" && !snapshot ? (
            <Skeleton />
          ) : status === "error" && !snapshot ? null : visible.length === 0 ? (
            <Empty />
          ) : (
            <>
              <p className="board__count">
                {visible.length} live need{visible.length === 1 ? "" : "s"} across {campCount} camp{campCount === 1 ? "" : "s"}
              </p>
              <div className="board__list">
                {visible.map((row, index) => (
                  <NeedCard key={row.key} row={row} snap={snap as Snap} district={district} index={index} />
                ))}
              </div>
            </>
          )}

          {snapshot?.data.truncated && (
            <p className="note note--warn">So many entities match that the result was cut off, so some are not shown. Switch to “Vouched only”, which asks Arkiv for a fixed set of creators.</p>
          )}
          {rejected > 0 && filters.view === "open" && (
            <p className="note">
              <b>{rejected} post{rejected === 1 ? " was" : "s were"} ignored.</b> Each names a camp but was written by a different wallet than the one that created that camp. On Arkiv anyone can write anything, so authorship (the
              entity’s creator) is what counts, not what a post claims.
            </p>
          )}
        </div>

        <aside className={`board__col board__col--map${pane === "map" ? " is-active" : ""}`}>
          <Suspense fallback={<p className="map__caption">Loading map…</p>}>{pane === "map" || window.matchMedia("(min-width: 1000px)").matches ? <MapPane /> : null}</Suspense>
        </aside>
      </div>
    </section>
  )
}
