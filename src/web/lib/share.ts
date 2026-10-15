import { formatDuration } from "../../core/format"
import type { Item } from "../../core/schema"
import { ITEM_LABELS } from "./labels"

export const needUrl = (key: string, origin = window.location.origin) => `${origin}/n/${key}`

export const whatsappLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`

// What a volunteer pastes into a WhatsApp group. It always carries the link, so the group can check whether the need
// is still live before anyone loads a vehicle.
export function shareMessage(x: {
  item: Item
  camp: string
  district: string
  qty: bigint
  pledged: bigint
  gap: bigint
  secondsLeft: number
  url: string
}): string {
  return [
    `NEEDED NOW: ${ITEM_LABELS[x.item].en} (${ITEM_LABELS[x.item].hi})`,
    `${x.camp}, ${x.district}`,
    `${x.gap} still short (${x.qty} asked, ${x.pledged} promised)`,
    `The camp confirmed this and it lapses in ${formatDuration(x.secondsLeft)} unless they confirm again.`,
    `Check it is still live before you forward or load a vehicle: ${x.url}`,
  ].join("\n")
}
