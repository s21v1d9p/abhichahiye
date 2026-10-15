export const APP = "abhichahiye" as const

export const KIND = {
  org: "org",
  site: "site",
  need: "need",
  pledge: "pledge",
  receipt: "receipt",
  vouch: "vouch",
} as const
export type Kind = (typeof KIND)[keyof typeof KIND]

export const ITEMS = [
  "water",
  "food",
  "ors",
  "blankets",
  "clothes",
  "sanitary",
  "medicine",
  "baby_food",
  "tarpaulin",
] as const
export type Item = (typeof ITEMS)[number]

export const ORG_TYPES = ["govt", "ngo", "volunteer"] as const
export type OrgType = (typeof ORG_TYPES)[number]

export const SITE_TYPES = ["camp", "collection", "kitchen"] as const
export type SiteType = (typeof SITE_TYPES)[number]

export type Urgency = 1 | 2 | 3

const HOUR = 3600
const DAY = 24 * HOUR

// Entity Expiration per kind, in seconds: how long each Arkiv entity lives before it lapses unless extended.
export const MAX_QTY = 10_000_000

export const LIFETIME = {
  org: 90 * DAY,
  site: 7 * DAY,
  need: { 3: 6 * HOUR, 2: 12 * HOUR, 1: 24 * HOUR } as Record<Urgency, number>,
  pledgeGrace: 2 * HOUR,
  pledgeMaxHorizon: 48 * HOUR,
  receipt: 30 * DAY,
  vouch: 30 * DAY,
} as const
