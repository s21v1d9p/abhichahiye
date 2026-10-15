import { useEffect, useRef, useState } from "react"
import type { Backend } from "./backend"

const SETTLE_MS = 1500
const MIN_GAP_MS = 8000

// Events are chain-wide and cannot be filtered by attribute, and looking an entity up costs as much as a full query.
// So an event only counts if it touches an entity already on screen, or comes from a wallet already on screen (a camp
// posting a new need, a donor pledging again). Anything else is picked up by the next scheduled refresh.
// Returns whether the subscription is open (the "live" light).
export function useLiveEvents(backend: Backend, isRelevant: (key: string, owner: string | undefined) => boolean, onRelevant: () => void): boolean {
  const [live, setLive] = useState(false)
  const relevantRef = useRef(isRelevant)
  const notifyRef = useRef(onRelevant)
  relevantRef.current = isRelevant
  notifyRef.current = onRelevant

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending = false
    let last = 0
    // A burst of events causes one refresh, and refreshes stay at least MIN_GAP_MS apart.
    const schedule = () => {
      if (pending) return
      pending = true
      timer = setTimeout(
        () => {
          pending = false
          last = Date.now()
          notifyRef.current()
        },
        Math.max(SETTLE_MS, last + MIN_GAP_MS - Date.now()),
      )
    }

    let unwatch: (() => void) | undefined
    try {
      unwatch = backend.events().watchEntityEvents({
        onEvent: (event) => {
          const owner = "owner" in event ? event.owner.toLowerCase() : undefined
          if (relevantRef.current(event.entityKey.toLowerCase(), owner)) schedule()
        },
        onError: () => setLive(false),
      })
      setLive(true)
    } catch {
      setLive(false)
    }
    return () => {
      clearTimeout(timer)
      unwatch?.()
    }
  }, [backend])

  return live
}
