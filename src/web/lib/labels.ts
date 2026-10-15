import type { Item, Urgency } from "../../core/schema"

// Hindi and Assamese names sit beside the English ones because camp staff and volunteers read all three.
export const ITEM_LABELS: Record<Item, { en: string; hi: string; as: string }> = {
  water: { en: "Drinking water", hi: "पीने का पानी", as: "খোৱা পানী" },
  food: { en: "Food", hi: "खाना", as: "আহাৰ" },
  ors: { en: "ORS", hi: "ओआरएस", as: "ORS" },
  blankets: { en: "Blankets", hi: "कंबल", as: "কম্বল" },
  clothes: { en: "Clothes", hi: "कपड़े", as: "কাপোৰ" },
  sanitary: { en: "Sanitary supplies", hi: "सैनिटरी सामान", as: "চেনিটাৰী সামগ্ৰী" },
  medicine: { en: "Medicine", hi: "दवा", as: "দৱা" },
  baby_food: { en: "Baby food", hi: "शिशु आहार", as: "শিশুৰ খাদ্য" },
  tarpaulin: { en: "Tarpaulin", hi: "तिरपाल", as: "তিৰপল" },
}

const URGENCY: Record<Urgency, { en: string; hi: string; short: string }> = {
  3: { en: "Critical · confirm every 6 h", hi: "अत्यावश्यक", short: "Critical" },
  2: { en: "Urgent · confirm every 12 h", hi: "ज़रूरी", short: "Urgent" },
  1: { en: "Needed · confirm every 24 h", hi: "आवश्यक", short: "Needed" },
}

export const urgencyLabel = (u: Urgency) => URGENCY[u]
export const asUrgency = (value: bigint | number): Urgency => (value === 3n || value === 3 ? 3 : value === 2n || value === 2 ? 2 : 1)

// "north_lakhimpur" → "North Lakhimpur": districts are stored as slugs and shown as names.
export const titleCase = (slug: string) => slug.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())
