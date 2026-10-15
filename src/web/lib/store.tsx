import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { Address, Hex } from "viem"
import { shortHex } from "../../core/format"
import { fromE6 } from "../../core/geo"
import { computeGaps, type Gap } from "../../core/gaps"
import { type DistrictData, loadDistrict, loadVerifiedDistrict } from "../../core/queries"
import { n, s } from "../../core/records"
import { type Item, LIFETIME, type Urgency } from "../../core/schema"
import { trustedOrgs } from "../../core/trust"
import { useBackend } from "./backend"
import type { Snap } from "./chainTime"
import { DEFAULT_DISTRICT, REFRESH_MS } from "./config"
import { asUrgency } from "./labels"
import { useLiveEvents } from "./live"
import { friendlyError } from "./tx"

export type Filters = { minUrgency: 1 | 2 | 3; item: Item | "all"; view: "open" | "verified" }

export type NeedRow = {
  key: Hex
  gap: Gap
  item: Item
  urgency: Urgency
  campName: string
  orgName: string
  campWallet: Hex
  vouched: boolean
  siteKey: Hex
  lat: number
  lng: number
  lifetime: number
  note: string
}

type Snapshot = { data: DistrictData; fetchedAt: number }
type Loaded = { status: "loading" | "ready" | "error"; snapshot?: Snapshot; error?: string }

export type Board = {
  district: string
  setDistrict: (district: string) => void
  filters: Filters
  setFilters: (patch: Partial<Filters>) => void
  status: Loaded["status"]
  snapshot?: Snapshot
  snap?: Snap
  rows: NeedRow[]
  rejected: number
  trusted: Set<Address>
  error?: string
  live: boolean
  refresh: () => void
}

function toRows(data: DistrictData, gaps: Gap[], trusted: Set<Address>): NeedRow[] {
  const orgNames = new Map(data.orgs.map((o) => [o.creator, String(o.payload.name ?? "")]))
  return gaps.map((gap) => {
    const need = gap.need
    const site = data.sitesByKey.get(s(need, "site"))
    const urgency = asUrgency(n(need, "urgency"))
    return {
      key: need.key,
      gap,
      item: s(need, "item") as Item,
      urgency,
      campName: String(site?.payload.name ?? shortHex(s(need, "site"))),
      orgName: orgNames.get(need.creator) || shortHex(need.creator),
      campWallet: need.creator,
      vouched: trusted.has(need.creator),
      siteKey: s(need, "site") as Hex,
      lat: fromE6(n(need, "lat_e6")),
      lng: fromE6(n(need, "lng_e6")),
      lifetime: LIFETIME.need[urgency],
      note: String(need.payload.note ?? ""),
    }
  })
}

const message = (e: unknown) => friendlyError(e)
const STORAGE_KEY = "abhichahiye:district"

const BoardContext = createContext<Board | undefined>(undefined)

export function BoardProvider({ children }: { children: ReactNode }) {
  const backend = useBackend()
  const [district, setDistrictState] = useState(() => localStorage.getItem(STORAGE_KEY) ?? DEFAULT_DISTRICT)
  const [filters, setFiltersState] = useState<Filters>({ minUrgency: 1, item: "all", view: "open" })
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" })

  const params = useRef({ district, filters })
  params.current = { district, filters }
  const inflight = useRef(false)
  const dirty = useRef(false)

  const load = useCallback(async () => {
    if (inflight.current) {
      dirty.current = true
      return
    }
    inflight.current = true
    try {
      do {
        dirty.current = false
        const { district: d, filters: f } = params.current
        const where = { district: d, minUrgency: f.minUrgency, ...(f.item === "all" ? {} : { item: f.item }) }
        try {
          const data = f.view === "verified" ? await loadVerifiedDistrict(backend.pub, where, backend.authorities) : await loadDistrict(backend.pub, where)
          if (params.current.district === d && params.current.filters === f) {
            setLoaded({ status: "ready", snapshot: { data, fetchedAt: Date.now() } })
          } else {
            dirty.current = true
          }
        } catch (e) {
          setLoaded((prev) => ({ status: "error", snapshot: prev.snapshot, error: message(e) }))
        }
      } while (dirty.current)
    } finally {
      inflight.current = false
    }
  }, [backend])

  useEffect(() => {
    void load()
  }, [load, district, filters])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") void load()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [load])

  const setDistrict = useCallback((next: string) => {
    const clean = next.trim()
    if (!clean) return
    localStorage.setItem(STORAGE_KEY, clean)
    setLoaded({ status: "loading" })
    setDistrictState(clean)
  }, [])

  const setFilters = useCallback((patch: Partial<Filters>) => {
    setFiltersState((prev) => {
      if (patch.view && patch.view !== prev.view) setLoaded({ status: "loading" })
      return { ...prev, ...patch }
    })
  }, [])

  const snapshot = loaded.snapshot
  const trusted = useMemo(() => (snapshot ? trustedOrgs(snapshot.data.vouches, backend.authorities) : new Set<Address>()), [snapshot, backend])
  const { rows, rejected } = useMemo(() => {
    if (!snapshot) return { rows: [] as NeedRow[], rejected: 0 }
    const { data, fetchedAt } = snapshot
    const gaps = computeGaps(data.needs, data.pledges, data.receipts, data.sitesByKey, { nowUnix: Math.floor(fetchedAt / 1000), block: data.block })
    return { rows: toRows(data, gaps, trusted), rejected: data.needs.length - gaps.length }
  }, [snapshot, trusted])

  const known = useMemo(() => {
    const keys = new Set<string>()
    const wallets = new Set<string>()
    if (snapshot) {
      for (const list of [snapshot.data.needs, snapshot.data.pledges, snapshot.data.receipts, snapshot.data.sites, snapshot.data.orgs, snapshot.data.vouches]) {
        for (const r of list) {
          keys.add(r.key)
          wallets.add(r.creator)
        }
      }
    }
    return { keys, wallets }
  }, [snapshot])
  const live = useLiveEvents(backend, (key, owner) => known.keys.has(key) || (owner !== undefined && known.wallets.has(owner)), () => void load())

  const value: Board = {
    district,
    setDistrict,
    filters,
    setFilters,
    status: loaded.status,
    ...(snapshot ? { snapshot, snap: { block: snapshot.data.block, fetchedAt: snapshot.fetchedAt } } : {}),
    rows,
    rejected,
    trusted,
    ...(loaded.error ? { error: loaded.error } : {}),
    live,
    refresh: () => void load(),
  }
  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>
}

export function useBoard(): Board {
  const board = useContext(BoardContext)
  if (!board) throw new Error("useBoard must be used inside BoardProvider")
  return board
}
