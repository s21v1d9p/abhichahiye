import type { Hex } from "viem"

export const DEFAULT_DISTRICT = "dhemaji"

// Free-text district search works for any district; these are suggestions for Q3 2026's flood-hit areas.
export const DISTRICT_SUGGESTIONS = ["Dhemaji", "Lakhimpur", "Majuli", "Dibrugarh", "Tinsukia", "Barpeta", "Darbhanga", "Kendrapara", "Alappuzha"]

// Public wallet of the demo district authority ("Dhemaji DDMA (demo)"), created by `npm run seed`.
// The verified view only trusts vouches written by wallets listed here.
export const TRUSTED_AUTHORITIES: Hex[] = ["0xAF4326E72570237fF4541C4c4E64E22F43da2C0e"]

// Live events do most of the refreshing; this is the safety net. Each refresh is one Arkiv query (100 cost units).
export const REFRESH_MS = 90_000

export const INDIAN_STATES: Array<[code: string, name: string]> = [
  ["AN", "Andaman and Nicobar Islands"], ["AP", "Andhra Pradesh"], ["AR", "Arunachal Pradesh"], ["AS", "Assam"], ["BR", "Bihar"],
  ["CH", "Chandigarh"], ["CG", "Chhattisgarh"], ["DH", "Dadra and Nagar Haveli and Daman and Diu"], ["DL", "Delhi"], ["GA", "Goa"],
  ["GJ", "Gujarat"], ["HR", "Haryana"], ["HP", "Himachal Pradesh"], ["JK", "Jammu and Kashmir"], ["JH", "Jharkhand"],
  ["KA", "Karnataka"], ["KL", "Kerala"], ["LA", "Ladakh"], ["LD", "Lakshadweep"], ["MP", "Madhya Pradesh"],
  ["MH", "Maharashtra"], ["MN", "Manipur"], ["ML", "Meghalaya"], ["MZ", "Mizoram"], ["NL", "Nagaland"],
  ["OD", "Odisha"], ["PY", "Puducherry"], ["PB", "Punjab"], ["RJ", "Rajasthan"], ["SK", "Sikkim"],
  ["TN", "Tamil Nadu"], ["TG", "Telangana"], ["TR", "Tripura"], ["UP", "Uttar Pradesh"], ["UK", "Uttarakhand"], ["WB", "West Bengal"],
]

export const REPO_URL = "https://github.com/s21v1d9p/abhichahiye"
