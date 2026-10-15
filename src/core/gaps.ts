import { n, type Rec, s } from "./records"
import { isAuthenticNeed, isValidReceipt } from "./trust"

export type Gap = { need: Rec; qty: bigint; pledged: bigint; gap: bigint; openPledges: Rec[] }

// A pledge stops counting once the camp itself has written a receipt for it; a receipt from anyone else is ignored.
export function computeGaps(needs: Rec[], pledges: Rec[], receipts: Rec[], sitesByKey: Map<string, Rec>): Gap[] {
  const fulfilled = new Set(receipts.filter((r) => isValidReceipt(r, sitesByKey)).map((r) => s(r, "pledge")))
  const open = pledges.filter((p) => !fulfilled.has(p.key))
  return needs
    .filter((need) => isAuthenticNeed(need, sitesByKey))
    .map((need) => {
      const mine = open.filter((p) => s(p, "need") === need.key && s(p, "item") === s(need, "item"))
      const pledged = mine.reduce((sum, p) => sum + n(p, "qty"), 0n)
      const qty = n(need, "qty")
      return { need, qty, pledged, gap: qty > pledged ? qty - pledged : 0n, openPledges: mine }
    })
    .sort((a, b) => {
      const byUrgency = n(b.need, "urgency") - n(a.need, "urgency")
      if (byUrgency !== 0n) return byUrgency > 0n ? 1 : -1
      return b.gap === a.gap ? 0 : b.gap > a.gap ? 1 : -1
    })
}
