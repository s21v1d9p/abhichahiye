import { n, type Rec, s } from "./records"
import { type Clock, isAuthenticNeed, isWellFormedPledge, settles } from "./trust"

export type Gap = { need: Rec; qty: bigint; pledged: bigint; gap: bigint; openPledges: Rec[] }

// A pledge stops reducing a need's gap once the camp that created the need has written a receipt for it.
export function computeGaps(
  needs: Rec[],
  pledges: Rec[],
  receipts: Rec[],
  sitesByKey: Map<string, Rec>,
  clock: Clock,
): Gap[] {
  const receiptsByPledge = new Map<string, Rec[]>()
  for (const receipt of receipts) {
    const pledgeKey = s(receipt, "pledge")
    receiptsByPledge.set(pledgeKey, [...(receiptsByPledge.get(pledgeKey) ?? []), receipt])
  }
  const live = pledges.filter((p) => isWellFormedPledge(p, clock))
  return needs
    .filter((need) => isAuthenticNeed(need, sitesByKey))
    .map((need) => {
      const mine = live.filter(
        (p) =>
          s(p, "need") === need.key &&
          s(p, "item") === s(need, "item") &&
          !(receiptsByPledge.get(p.key) ?? []).some((r) => settles(r, p, need)),
      )
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
