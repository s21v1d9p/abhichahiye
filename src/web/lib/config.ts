import type { Hex } from "viem"

export const DEFAULT_DISTRICT = "dhemaji"

// Free-text district search works for any district; these are suggestions for Q3 2026's flood-hit areas.
export const DISTRICT_SUGGESTIONS = ["Dhemaji", "Lakhimpur", "Majuli", "Dibrugarh", "Tinsukia", "Barpeta", "Darbhanga", "Kendrapara", "Alappuzha"]

// Public wallet of the demo district authority ("Dhemaji DDMA (demo)"), created by `npm run seed`.
// The verified view only trusts vouches written by wallets listed here.
export const TRUSTED_AUTHORITIES: Hex[] = ["0xAF4326E72570237fF4541C4c4E64E22F43da2C0e"]

export const REFRESH_MS = 20_000

export const REPO_URL = "https://github.com/s21v1d9p/abhichahiye"
