import { useEffect, useRef, useState } from "react"
import type { Hex } from "viem"
import { APP } from "../../core/schema"
import type { Backend } from "./backend"

const MAX_PENDING = 30

// Events are chain-wide. A change matters here only if it touches a key already on screen, or if a newly created
// entity turns out to belong to this app. Returns whether the subscription is open (the "live" light).
export function useLiveEvents(backend: Backend, isKnown: (key: string) => boolean, onRelevant: () => void): boolean {
  const [live, setLive] = useState(false)
  const knownRef = useRef(isKnown)
  const notifyRef = useRef(onRelevant)
  knownRef.current = isKnown
  notifyRef.current = onRelevant

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const pending = new Set<Hex>()
    let checking = false

    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => notifyRef.current(), 500)
    }

    const checkCreated = async () => {
      if (checking) return
      checking = true
      try {
        while (pending.size > 0 && !stopped) {
          const [key] = pending
          if (key === undefined) break
          pending.delete(key)
          try {
            const entity = await backend.pub.getEntity(key)
            if (entity.attributes.app?.value === APP) schedule()
          } catch {
            // Already expired, deleted, or not ours: nothing to show.
          }
        }
      } finally {
        checking = false
      }
    }

    let unwatch: (() => void) | undefined
    try {
      unwatch = backend.events().watchEntityEvents({
        onEvent: (event) => {
          if (event.type === "EntityCreated") {
            if (pending.size >= MAX_PENDING) {
              pending.clear()
              schedule()
              return
            }
            pending.add(event.entityKey)
            void checkCreated()
          } else if (knownRef.current(event.entityKey.toLowerCase())) {
            schedule()
          }
        },
        onError: () => setLive(false),
      })
      setLive(true)
    } catch {
      setLive(false)
    }
    return () => {
      stopped = true
      clearTimeout(timer)
      unwatch?.()
    }
  }, [backend])

  return live
}
