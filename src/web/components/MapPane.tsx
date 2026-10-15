import type { LatLngBounds } from "leaflet"
import "leaflet/dist/leaflet.css"
import { useEffect, useMemo, useRef, useState } from "react"
import { CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet"
import { formatDuration } from "../../core/format"
import { fromE6 } from "../../core/geo"
import { loadBox } from "../../core/queries"
import { n, type Rec, s } from "../../core/records"
import type { Item, Urgency } from "../../core/schema"
import { useBackend } from "../lib/backend"
import { secondsUntil } from "../lib/chainTime"
import { ITEM_LABELS, asUrgency } from "../lib/labels"
import { type NeedRow, useBoard } from "../lib/store"
import { useNowMs } from "../lib/ticker"

const URGENCY_COLOR: Record<Urgency, string> = { 3: "#d02f1c", 2: "#f2a100", 1: "#0a68a4" }
const ASSAM: [number, number] = [27.3, 94.7]

type Pin = { key: string; name: string; district: string; lat: number; lng: number; needs: Rec[]; urgency: Urgency }
type BoxData = { block: bigint; needs: Rec[]; sites: Rec[]; truncated: boolean; fetchedAt: number }

function pinsOf(box: BoxData | undefined): Pin[] {
  if (!box) return []
  const byCamp = new Map<string, Rec[]>()
  for (const need of box.needs) byCamp.set(s(need, "site"), [...(byCamp.get(s(need, "site")) ?? []), need])
  const pins: Pin[] = []
  for (const site of box.sites) {
    const needs = byCamp.get(site.key)
    if (!needs) continue
    pins.push({
      key: site.key,
      name: String(site.payload.name ?? site.key),
      district: s(site, "district"),
      lat: fromE6(n(site, "lat_e6")),
      lng: fromE6(n(site, "lng_e6")),
      needs,
      urgency: asUrgency(needs.reduce((max, x) => (n(x, "urgency") > max ? n(x, "urgency") : max), 1n)),
    })
  }
  return pins
}

function Viewport({ onBounds }: { onBounds: (bounds: LatLngBounds) => void }) {
  const map = useMap()
  useMapEvents({ moveend: () => onBounds(map.getBounds()) })
  useEffect(() => onBounds(map.getBounds()), [map, onBounds])
  return null
}

function FitTo({ rows, district }: { rows: NeedRow[]; district: string }) {
  const map = useMap()
  const fitted = useRef("")
  useEffect(() => {
    const signature = `${district}:${rows.length > 0}`
    if (rows.length === 0 || fitted.current === signature) return
    fitted.current = signature
    const points = rows.map((r) => [r.lat, r.lng] as [number, number])
    map.fitBounds(points, { padding: [48, 48], maxZoom: 10 })
  }, [rows, district, map])
  return null
}

export default function MapPane() {
  const backend = useBackend()
  const { rows, district, setDistrict } = useBoard()
  const [box, setBox] = useState<BoxData>()
  const [failed, setFailed] = useState(false)
  const nowMs = useNowMs()
  const request = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Panning the map asks Arkiv directly: camps and needs inside the viewport, by numeric range on lat_e6 / lng_e6.
  const onBounds = useMemo(
    () => (bounds: LatLngBounds) => {
      clearTimeout(timer.current)
      timer.current = setTimeout(async () => {
        const id = ++request.current
        try {
          const view = await loadBox(backend.pub, { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() })
          if (id === request.current) {
            setBox({ ...view, fetchedAt: Date.now() })
            setFailed(false)
          }
        } catch {
          if (id === request.current) setFailed(true)
        }
      }, 450)
    },
    [backend],
  )
  useEffect(() => () => clearTimeout(timer.current), [])

  const pins = useMemo(() => pinsOf(box), [box])

  return (
    <div className="map">
      <MapContainer center={ASSAM} zoom={8} scrollWheelZoom className="map__canvas" attributionControl>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Viewport onBounds={onBounds} />
        <FitTo rows={rows} district={district} />
        {pins.map((pin) => (
          <CircleMarker
            key={pin.key}
            center={[pin.lat, pin.lng]}
            radius={9 + Math.min(pin.needs.length, 4) * 3}
            pathOptions={{ color: "#12202b", weight: 2.5, fillColor: URGENCY_COLOR[pin.urgency], fillOpacity: 0.92 }}
          >
            <Popup>
              <div className="pin">
                <strong className="pin__name">{pin.name}</strong>
                <span className="pin__district">{pin.district.replaceAll("_", " ")}</span>
                <ul className="pin__needs">
                  {pin.needs.map((need) => (
                    <li key={need.key}>
                      <span>{ITEM_LABELS[s(need, "item") as Item].en}</span>
                      <b>{n(need, "qty").toString()}</b>
                      <em>{box ? formatDuration(secondsUntil(need.expiresAt, box, nowMs)) : ""}</em>
                    </li>
                  ))}
                </ul>
                <button type="button" className="btn btn--small" onClick={() => setDistrict(pin.district)}>
                  Show this district
                </button>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      <p className="map__caption" role="status">
        {failed ? "Map data could not be loaded from Arkiv." : box ? `${pins.length} camp${pins.length === 1 ? "" : "s"} with live needs in view, read from Arkiv by latitude and longitude range.` : "Reading this map view from Arkiv…"}
        {box?.truncated && " Some results were cut off; zoom in."}
      </p>
    </div>
  )
}
