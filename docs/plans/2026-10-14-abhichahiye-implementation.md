# AbhiChahiye Implementation Plan

**Goal:** Ship a public, working relief-needs board on Arkiv Tiramisu where needs expire unless the camp re-confirms them, pledges expire at their promised delivery time, and trust comes from `$creator`, plus all hackathon submission artefacts, before 18 Oct 2026 22:59 UTC.

**Architecture:** One TypeScript repo. `src/core` holds all Arkiv logic (schema, attribute builders, expiry policy, queries, writes, gap and trust computation) and is shared by the Vite + React web app (`src/web`), a CLI (`cli/`), and a seed script (`scripts/`). No application backend; one Vercel function (`api/drip.ts`) only funds burner wallets with test GLM.

**Tech Stack:** TypeScript 5, Node 22, `@arkiv-network/sdk` 0.8.1 + `viem` 2, Vite + React 18, `wouter` (routing), `leaflet` + `react-leaflet` (map), `vitest` (unit), `tsx` (scripts), Vercel (hosting).

**Deadline math:** 18 Oct 22:59 UTC = 19 Oct 04:29 IST. Target submit: 18 Oct 20:00 IST.

**Note on code completeness:** core logic, tests, scripts and the drip function are given as complete code. UI tasks give exact files, behaviour and the Arkiv-touching code; presentational JSX is written during execution.

---

### Task 0: Funded Tiramisu wallet (user + agent)

**Files:** Create `.env` (gitignored)

**Step 1:** Agent generates a funder key into `.env` without printing the key:
```bash
node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();require('fs').writeFileSync('.env','FUNDER_PK='+k+'\n',{flag:'a'});console.log(privateKeyToAccount(k).address)"
```
(run after Task 1 installs viem). Prints only the address.

**Step 2 (user):** Open https://hub.arkiv.network/faucet, request test GLM for that address.

**Step 3: Verify** `npx tsx --env-file=.env scripts/balance.ts` prints a non-zero GLM balance.

---

### Task 1: Scaffold

**Files:** Create `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/web/main.tsx`, `vitest.config.ts`, `scripts/balance.ts`

**Step 1:** Create `package.json`:
```json
{
  "name": "abhichahiye",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "seed": "tsx --env-file=.env scripts/seed.ts",
    "abhi": "tsx cli/abhi.ts"
  }
}
```
**Step 2:** Install:
```bash
npm i @arkiv-network/sdk@0.8.1 viem react react-dom wouter leaflet react-leaflet
npm i -D typescript vite @vitejs/plugin-react vitest tsx @types/react @types/react-dom @types/leaflet @types/node @vercel/node
```
**Step 3:** `tsconfig.json` (strict, `"moduleResolution": "bundler"`, `"jsx": "react-jsx"`, `"target": "ES2022"`, `"lib": ["ES2022","DOM"]`, `"types": ["node"]`, include `src`, `cli`, `scripts`, `api`). `vite.config.ts` with `@vitejs/plugin-react`. `vitest.config.ts` with `test.include = ["src/**/*.test.ts"]`.

**Step 4:** `scripts/balance.ts`:
```ts
import { createPublicClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { formatEther, http, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const pk = process.env.FUNDER_PK as Hex
if (!pk) throw new Error("FUNDER_PK missing in .env")
const address = privateKeyToAccount(pk).address
const client = createPublicClient({ chain: tiramisu, transport: http() })
console.log(address, formatEther(await client.getBalance({ address })), "GLM")
```
**Step 5: Verify:** `npx vite build` succeeds with a placeholder `main.tsx`; `npx vitest run --passWithNoTests` exits 0.

**Step 6: Commit** `chore: scaffold vite + react + arkiv sdk`.

---

### Task 2: Live probe (first Arkiv entity) + friction log

**Files:** Create `scripts/probe.ts`, `arkiv/friction.md`

**Step 1:** `scripts/probe.ts`: create one entity `{app:"abhichahiye-probe", kind:"probe", n:u64(1)}` with `ExpirationTime.fromMinutes(10)`, then `getEntity`, `select().where(and(eq("app","abhichahiye-probe"), gte("n", u64(1)))).fetch()`, `extendEntity` to `atBlock(renewalTarget)`, a 2-op `executeBatch`, and `getBlockTiming()`. Print entity key, tx hashes, explorer links, gas used per op (`getTransactionReceipt`), balance before/after.

**Step 2: Verify:** run `npx tsx --env-file=.env scripts/probe.ts`; output contains an entity key and the query returns ≥1 entity. Open the explorer link.

**Step 3:** Record in `arkiv/friction.md`: time to first entity, versions (SDK 0.8.1, viem version, Node 22.20.0), cost per op, anything unexpected, each with expected/actual/repro. Re-verify candidate issues from the session notes (`$createdAt` not filterable in the SDK builder; README `^0.6.0` snippet; `ne`/`exists` rejected by node) by running them; keep only reproduced ones.

**Step 4: Commit** `chore: live probe on tiramisu; start friction log`.

---

### Task 3: Schema + geo

**Files:** Create `src/core/schema.ts`, `src/core/geo.ts`, `src/core/geo.test.ts`

**Step 1: Failing test** `src/core/geo.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { fromE6, slug, toE6 } from "./geo"

describe("geo", () => {
  it("round-trips degrees through e6 integers", () => {
    expect(toE6(27.483912)).toBe(27483912n)
    expect(fromE6(94.578)).toBeCloseTo(0.000094578)
    expect(fromE6(toE6(94.578123))).toBeCloseTo(94.578123, 6)
  })
  it("rejects coordinates outside 0..180", () => {
    expect(() => toE6(-1)).toThrow(RangeError)
    expect(() => toE6(Number.NaN)).toThrow(RangeError)
  })
  it("slugs district names for equality queries", () => {
    expect(slug("  North Lakhimpur ")).toBe("north_lakhimpur")
    expect(slug("Dhemaji")).toBe("dhemaji")
  })
})
```
**Step 2:** `npx vitest run src/core/geo.test.ts` → FAIL (module not found).

**Step 3:** `src/core/schema.ts`:
```ts
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

export const ITEMS = ["water", "food", "ors", "blankets", "clothes", "sanitary", "medicine", "baby_food", "tarpaulin"] as const
export type Item = (typeof ITEMS)[number]

export const ORG_TYPES = ["govt", "ngo", "volunteer"] as const
export type OrgType = (typeof ORG_TYPES)[number]

export const SITE_TYPES = ["camp", "collection", "kitchen"] as const
export type SiteType = (typeof SITE_TYPES)[number]

export type Urgency = 1 | 2 | 3

const HOUR = 3600
const DAY = 24 * HOUR

export const TTL = {
  org: 90 * DAY,
  site: 7 * DAY,
  need: { 3: 6 * HOUR, 2: 12 * HOUR, 1: 24 * HOUR } as Record<Urgency, number>,
  pledgeGrace: 2 * HOUR,
  receipt: 30 * DAY,
  vouch: 30 * DAY,
} as const
```
`src/core/geo.ts`:
```ts
export function toE6(deg: number): bigint {
  if (!Number.isFinite(deg) || deg < 0 || deg > 180) {
    throw new RangeError(`coordinate must be within 0..180 degrees, got ${deg}`)
  }
  return BigInt(Math.round(deg * 1_000_000))
}

export function fromE6(value: bigint | number): number {
  return Number(value) / 1_000_000
}

export function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
}

export type Box = { south: number; west: number; north: number; east: number }
```
**Step 4:** test → PASS. **Step 5: Commit** `feat(core): schema constants and geo helpers`.

---

### Task 4: Records + attribute builders

**Files:** Create `src/core/records.ts`, `src/core/attrs.ts`, `src/core/attrs.test.ts`

**Step 1: Failing test** `src/core/attrs.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { needAttrs, orgAttrs, pledgeAttrs, receiptAttrs, assertNoPhone } from "./attrs"
import { n, s, toRec } from "./records"

const SITE = "0x" + "a".repeat(64) as `0x${string}`
const NEED = "0x" + "b".repeat(64) as `0x${string}`

describe("attribute builders", () => {
  it("builds typed need attributes with numeric ranges", () => {
    const a = needAttrs({ site: SITE, state: "AS", district: "Dhemaji", item: "clothes", qty: 300, urgency: 3, lat: 27.48, lng: 94.58 })
    expect(a.app).toEqual({ type: "str", value: "abhichahiye" })
    expect(a.kind).toEqual({ type: "str", value: "need" })
    expect(a.district).toEqual({ type: "str", value: "dhemaji" })
    expect(a.qty).toEqual({ type: "u64", value: 300n })
    expect(a.urgency).toEqual({ type: "u64", value: 3n })
    expect(a.lat_e6).toEqual({ type: "u64", value: 27480000n })
    expect(a.site.type).toBe("key")
  })
  it("rejects non-positive quantities and bad urgency", () => {
    expect(() => needAttrs({ site: SITE, state: "AS", district: "d", item: "ors", qty: 0, urgency: 2, lat: 27, lng: 94 })).toThrow()
    expect(() => needAttrs({ site: SITE, state: "AS", district: "d", item: "ors", qty: 5, urgency: 4 as 3, lat: 27, lng: 94 })).toThrow()
  })
  it("pledge and receipt link by entity key", () => {
    const p = pledgeAttrs({ need: NEED, site: SITE, district: "Dhemaji", item: "clothes", qty: 100, eta: 1_760_000_000 })
    expect(p.need.value).toBe(NEED)
    expect(p.eta).toEqual({ type: "u64", value: 1_760_000_000n })
    const r = receiptAttrs({ pledge: NEED, need: NEED, site: SITE, district: "Dhemaji", qty: 100, pledger: "0x1111111111111111111111111111111111111111" })
    expect(r.pledger.type).toBe("addr")
    expect(r.district.value).toBe("dhemaji")
  })
  it("org attributes are lowercase-normalised", () => {
    expect(orgAttrs({ orgType: "ngo", state: "AS", district: "North Lakhimpur" }).district.value).toBe("north_lakhimpur")
  })
  it("blocks Indian mobile numbers in free text", () => {
    expect(() => assertNoPhone("call 9876543210 now")).toThrow()
    expect(() => assertNoPhone("+91 98765 43210")).toThrow()
    expect(() => assertNoPhone("300 sets of clothes, sizes S-XL")).not.toThrow()
  })
})

describe("toRec", () => {
  it("normalises an SDK entity into a plain record", () => {
    const r = toRec({
      key: NEED,
      creator: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      owner: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      expiresAt: 123n,
      attributes: { qty: { type: "u64", value: 5n }, item: { type: "str", value: "ors" } },
      payload: new TextEncoder().encode(JSON.stringify({ note: "hi" })),
    })
    expect(r.creator).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
    expect(n(r, "qty")).toBe(5n)
    expect(s(r, "item")).toBe("ors")
    expect(r.payload).toEqual({ note: "hi" })
  })
})
```
**Step 2:** run → FAIL.

**Step 3:** `src/core/records.ts`:
```ts
import type { Address, Hex } from "viem"

export type AttrValue = string | bigint

export type Rec = {
  key: Hex
  creator: Address
  owner: Address
  expiresAt: bigint
  attrs: Record<string, AttrValue>
  payload: Record<string, unknown>
}

type EntityLike = {
  key?: Hex | undefined
  creator?: Hex | undefined
  owner?: Hex | undefined
  expiresAt?: bigint | undefined
  attributes?: Readonly<Record<string, { type: string; value: unknown }>> | undefined
  payload?: Uint8Array | undefined
}

export function toRec(e: EntityLike): Rec {
  if (!e.key || !e.creator || !e.owner || e.expiresAt === undefined) {
    throw new Error("entity is missing key/creator/owner/expiresAt: select them in the query")
  }
  const attrs: Record<string, AttrValue> = {}
  for (const [name, v] of Object.entries(e.attributes ?? {})) {
    attrs[name] = typeof v.value === "bigint" ? v.value : String(v.value).toLowerCase()
  }
  let payload: Record<string, unknown> = {}
  if (e.payload && e.payload.length > 0) {
    try {
      payload = JSON.parse(new TextDecoder().decode(e.payload))
    } catch {
      payload = {}
    }
  }
  return {
    key: e.key.toLowerCase() as Hex,
    creator: e.creator.toLowerCase() as Address,
    owner: e.owner.toLowerCase() as Address,
    expiresAt: e.expiresAt,
    attrs,
    payload,
  }
}

export const s = (r: Rec, name: string): string => String(r.attrs[name] ?? "")
export const n = (r: Rec, name: string): bigint => {
  const v = r.attrs[name]
  return typeof v === "bigint" ? v : 0n
}
```
`src/core/attrs.ts`:
```ts
import { addr, key, str, u64 } from "@arkiv-network/sdk/attr"
import type { Address, Hex } from "viem"
import { slug, toE6 } from "./geo"
import { APP, KIND, type Item, type OrgType, type SiteType, type Urgency } from "./schema"

const base = (kind: string) => ({ app: str(APP), kind: str(kind) })

function positive(qty: number, what: string): bigint {
  if (!Number.isInteger(qty) || qty <= 0) throw new RangeError(`${what} must be a positive integer, got ${qty}`)
  return BigInt(qty)
}

function urgencyOf(u: number): bigint {
  if (u !== 1 && u !== 2 && u !== 3) throw new RangeError(`urgency must be 1, 2 or 3, got ${u}`)
  return BigInt(u)
}

const PHONE = /(?:\+?91[\s-]*)?[6-9](?:[\s-]*\d){9}/

export function assertNoPhone(text: string): void {
  if (PHONE.test(text)) throw new Error("Remove phone numbers: personal data must not be written to Arkiv")
}

export function orgAttrs(o: { orgType: OrgType; state: string; district: string }) {
  return { ...base(KIND.org), org_type: str(o.orgType), state: str(o.state.toLowerCase()), district: str(slug(o.district)) }
}

export function siteAttrs(x: { siteType: SiteType; state: string; district: string; lat: number; lng: number; people: number }) {
  return {
    ...base(KIND.site),
    site_type: str(x.siteType),
    state: str(x.state.toLowerCase()),
    district: str(slug(x.district)),
    lat_e6: u64(toE6(x.lat)),
    lng_e6: u64(toE6(x.lng)),
    people: u64(positive(x.people, "people")),
  }
}

export function needAttrs(x: { site: Hex; state: string; district: string; item: Item; qty: number; urgency: Urgency; lat: number; lng: number }) {
  return {
    ...base(KIND.need),
    site: key(x.site),
    state: str(x.state.toLowerCase()),
    district: str(slug(x.district)),
    item: str(x.item),
    qty: u64(positive(x.qty, "qty")),
    urgency: u64(urgencyOf(x.urgency)),
    lat_e6: u64(toE6(x.lat)),
    lng_e6: u64(toE6(x.lng)),
  }
}

export function pledgeAttrs(x: { need: Hex; site: Hex; district: string; item: Item; qty: number; eta: number }) {
  return {
    ...base(KIND.pledge),
    need: key(x.need),
    site: key(x.site),
    district: str(slug(x.district)),
    item: str(x.item),
    qty: u64(positive(x.qty, "qty")),
    eta: u64(positive(x.eta, "eta")),
  }
}

export function receiptAttrs(x: { pledge: Hex; need: Hex; site: Hex; district: string; qty: number; pledger: Address }) {
  return {
    ...base(KIND.receipt),
    pledge: key(x.pledge),
    need: key(x.need),
    site: key(x.site),
    district: str(slug(x.district)),
    qty: u64(positive(x.qty, "qty")),
    pledger: addr(x.pledger),
  }
}

export function vouchAttrs(x: { org: Address; district: string }) {
  return { ...base(KIND.vouch), org: addr(x.org), district: str(slug(x.district)) }
}
```
(If `toRec` lowercases `str` values, item/district comparisons stay consistent because builders already write lowercase.)

**Step 4:** run → PASS. Adjust expectations only if the SDK tagged-value shape differs (check `attr/values.ts`); never weaken assertions.

**Step 5: Commit** `feat(core): typed attribute builders and record normaliser`.

---

### Task 5: Expiry policy

**Files:** Create `src/core/expiry.ts`, `src/core/expiry.test.ts`

**Step 1: Failing test:**
```ts
import { describe, expect, it } from "vitest"
import { blocksFor, needsLeaseRenewal, renewalTarget, secondsLeft } from "./expiry"

describe("expiry policy", () => {
  it("converts seconds to 2 s blocks, rounding up", () => {
    expect(blocksFor(6 * 3600)).toBe(10800n)
    expect(blocksFor(3)).toBe(2n)
  })
  it("reports seconds left, never negative", () => {
    expect(secondsLeft(1100n, 1000n)).toBe(200)
    expect(secondsLeft(900n, 1000n)).toBe(0)
  })
  it("renews to ttl from now when that is later than the current expiry", () => {
    expect(renewalTarget(1500n, 1000n, 6 * 3600)).toBe(1000n + 10800n)
  })
  it("never produces a target that is not strictly later (engine would revert)", () => {
    expect(renewalTarget(50_000n, 1000n, 3600)).toBe(50_001n)
  })
  it("only renews a lease once it has meaningfully aged", () => {
    const ttl = 90 * 86400
    expect(needsLeaseRenewal(1000n + blocksFor(ttl), 1000n, ttl)).toBe(false)
    expect(needsLeaseRenewal(1000n + blocksFor(ttl - 7200), 1000n, ttl)).toBe(true)
  })
})
```
**Step 2:** run → FAIL.

**Step 3:** `src/core/expiry.ts`:
```ts
import { ExpirationTime } from "@arkiv-network/sdk/utils"
import { TTL, type Urgency } from "./schema"

export const BLOCK_SECONDS = 2

export function blocksFor(seconds: number): bigint {
  return BigInt(Math.ceil(seconds / BLOCK_SECONDS))
}

export function secondsLeft(expiresAt: bigint, currentBlock: bigint): number {
  const d = expiresAt - currentBlock
  return d > 0n ? Number(d) * BLOCK_SECONDS : 0
}

export function renewalTarget(currentExpiresAt: bigint, currentBlock: bigint, ttlSeconds: number): bigint {
  const fromNow = currentBlock + blocksFor(ttlSeconds)
  return fromNow > currentExpiresAt ? fromNow : currentExpiresAt + 1n
}

export function needsLeaseRenewal(currentExpiresAt: bigint, currentBlock: bigint, ttlSeconds: number, slackSeconds = 3600): boolean {
  return secondsLeft(currentExpiresAt, currentBlock) < ttlSeconds - slackSeconds
}

export const needLifetime = (u: Urgency) => ExpirationTime.fromSeconds(TTL.need[u])
export const pledgeExpiry = (etaUnix: number) => ExpirationTime.atDate(new Date((etaUnix + TTL.pledgeGrace) * 1000))
```
**Step 4:** PASS. **Step 5: Commit** `feat(core): expiry policy (lifetimes, renewal targets, lease ageing)`.

---

### Task 6: Trust rules

**Files:** Create `src/core/trust.ts`, `src/core/trust.test.ts`

Rules (Security pillar, all based on immutable `$creator`, never on writable attributes):
- A `need` is authentic only if its `site` exists and `site.creator === need.creator`.
- A `receipt` counts only if its `site` exists and `site.creator === receipt.creator`.
- An org is vouched if a live `vouch` with `org = X` was created by a trusted authority wallet.

**Step 1: Failing test:**
```ts
import { describe, expect, it } from "vitest"
import type { Rec } from "./records"
import { isAuthenticNeed, isValidReceipt, trustedOrgs } from "./trust"

const rec = (key: string, creator: string, attrs: Record<string, string | bigint>): Rec => ({
  key: key as `0x${string}`, creator: creator as `0x${string}`, owner: creator as `0x${string}`, expiresAt: 1n, attrs, payload: {},
})
const CAMP = "0xcamp", IMPOSTOR = "0xbad", AUTH = "0xauth", NGO = "0xngo"
const site = rec("0xs1", CAMP, { kind: "site" })
const sites = new Map([[site.key, site]])

describe("trust", () => {
  it("accepts a need created by the site's creator", () => {
    expect(isAuthenticNeed(rec("0xn1", CAMP, { site: "0xs1" }), sites)).toBe(true)
  })
  it("rejects a need that points at someone else's site", () => {
    expect(isAuthenticNeed(rec("0xn2", IMPOSTOR, { site: "0xs1" }), sites)).toBe(false)
  })
  it("rejects a need whose site is gone", () => {
    expect(isAuthenticNeed(rec("0xn3", CAMP, { site: "0xmissing" }), sites)).toBe(false)
  })
  it("counts receipts only from the camp itself", () => {
    expect(isValidReceipt(rec("0xr1", CAMP, { site: "0xs1" }), sites)).toBe(true)
    expect(isValidReceipt(rec("0xr2", NGO, { site: "0xs1" }), sites)).toBe(false)
  })
  it("trusts orgs vouched by a trusted authority only", () => {
    const vouches = [rec("0xv1", AUTH, { org: NGO }), rec("0xv2", IMPOSTOR, { org: IMPOSTOR })]
    const t = trustedOrgs(vouches, [AUTH as `0x${string}`])
    expect(t.has(NGO as `0x${string}`)).toBe(true)
    expect(t.has(IMPOSTOR as `0x${string}`)).toBe(false)
  })
})
```
**Step 2:** FAIL. **Step 3:** `src/core/trust.ts`:
```ts
import type { Address } from "viem"
import { type Rec, s } from "./records"

export function isAuthenticNeed(need: Rec, sitesByKey: Map<string, Rec>): boolean {
  const site = sitesByKey.get(s(need, "site"))
  return !!site && site.creator === need.creator
}

export function isValidReceipt(receipt: Rec, sitesByKey: Map<string, Rec>): boolean {
  const site = sitesByKey.get(s(receipt, "site"))
  return !!site && site.creator === receipt.creator
}

export function trustedOrgs(vouches: Rec[], authorities: Address[]): Set<Address> {
  const auth = new Set(authorities.map((a) => a.toLowerCase()))
  return new Set(vouches.filter((v) => auth.has(v.creator)).map((v) => s(v, "org") as Address))
}
```
**Step 4:** PASS. **Step 5: Commit** `feat(core): creator-based trust rules`.

---

### Task 7: Gap computation

**Files:** Create `src/core/gaps.ts`, `src/core/gaps.test.ts`

**Step 1: Failing test:**
```ts
import { describe, expect, it } from "vitest"
import { computeGaps } from "./gaps"
import type { Rec } from "./records"

const rec = (key: string, creator: string, attrs: Record<string, string | bigint>): Rec => ({
  key: key as `0x${string}`, creator: creator as `0x${string}`, owner: creator as `0x${string}`, expiresAt: 1n, attrs, payload: {},
})
const site = rec("0xs1", "0xcamp", { kind: "site" })
const sites = new Map([[site.key, site]])
const clothes = rec("0xn1", "0xcamp", { site: "0xs1", item: "clothes", qty: 300n, urgency: 3n })
const rice = rec("0xn2", "0xcamp", { site: "0xs1", item: "food", qty: 100n, urgency: 1n })
const fake = rec("0xn3", "0xbad", { site: "0xs1", item: "water", qty: 999n, urgency: 3n })

describe("computeGaps", () => {
  it("subtracts open pledges from need quantity", () => {
    const p = rec("0xp1", "0xngo", { need: "0xn1", item: "clothes", qty: 120n })
    const [g] = computeGaps([clothes], [p], [], sites)
    expect(g.pledged).toBe(120n)
    expect(g.gap).toBe(180n)
  })
  it("ignores pledges already fulfilled by a valid receipt", () => {
    const p = rec("0xp1", "0xngo", { need: "0xn1", item: "clothes", qty: 120n })
    const r = rec("0xr1", "0xcamp", { pledge: "0xp1", site: "0xs1" })
    expect(computeGaps([clothes], [p], [r], sites)[0].pledged).toBe(0n)
  })
  it("ignores receipts not created by the camp", () => {
    const p = rec("0xp1", "0xngo", { need: "0xn1", item: "clothes", qty: 120n })
    const forged = rec("0xr9", "0xngo", { pledge: "0xp1", site: "0xs1" })
    expect(computeGaps([clothes], [p], [forged], sites)[0].pledged).toBe(120n)
  })
  it("never reports a negative gap", () => {
    const p = rec("0xp1", "0xngo", { need: "0xn1", item: "clothes", qty: 500n })
    expect(computeGaps([clothes], [p], [], sites)[0].gap).toBe(0n)
  })
  it("drops needs that fail authenticity and sorts by urgency then gap", () => {
    const gaps = computeGaps([rice, fake, clothes], [], [], sites)
    expect(gaps.map((g) => g.need.key)).toEqual(["0xn1", "0xn2"])
  })
})
```
**Step 2:** FAIL. **Step 3:** `src/core/gaps.ts`:
```ts
import { n, type Rec, s } from "./records"
import { isAuthenticNeed, isValidReceipt } from "./trust"

export type Gap = { need: Rec; qty: bigint; pledged: bigint; gap: bigint; openPledges: Rec[] }

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
      const u = n(b.need, "urgency") - n(a.need, "urgency")
      if (u !== 0n) return u > 0n ? 1 : -1
      return b.gap === a.gap ? 0 : b.gap > a.gap ? 1 : -1
    })
}
```
**Step 4:** PASS (`npx vitest run` — all core suites). **Step 5: Commit** `feat(core): gap computation over live needs, pledges and receipts`.

---

### Task 8: Clients + queries

**Files:** Create `src/core/arkiv.ts`, `src/core/queries.ts`, `scripts/query-smoke.ts`

**Step 1:** `src/core/arkiv.ts`:
```ts
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http, webSocket, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export const EXPLORER = "https://tiramisu.explorer.arkiv.network"
export const makePublicClient = () => createPublicClient({ chain: tiramisu, transport: http() })
export const makeWsClient = () => createPublicClient({ chain: tiramisu, transport: webSocket() })
export const makeWalletClient = (pk: Hex) =>
  createWalletClient({ chain: tiramisu, transport: http(), account: privateKeyToAccount(pk) })
export type PublicClient = ReturnType<typeof makePublicClient>
export type WalletClient = ReturnType<typeof makeWalletClient>
```
**Step 2:** `src/core/queries.ts`:
```ts
import { u64 } from "@arkiv-network/sdk/attr"
import { and, eq, gte, lte, type Expression } from "@arkiv-network/sdk/query"
import type { Hex } from "viem"
import type { PublicClient } from "./arkiv"
import { type Box, slug, toE6 } from "./geo"
import { type Rec, toRec } from "./records"
import { APP, type Item, type Kind } from "./schema"

const MAX_RESULTS = 1000

export async function fetchAll(client: PublicClient, where: Expression[], opts: { createdBy?: Hex; ownedBy?: Hex } = {}): Promise<Rec[]> {
  let q = client
    .select({ key: true, owner: true, creator: true, expiresAt: true, attributes: true, payload: true })
    .where(where)
    .limit(200)
  if (opts.createdBy) q = q.createdBy(opts.createdBy)
  if (opts.ownedBy) q = q.ownedBy(opts.ownedBy)
  let page = await q.fetch()
  const out = page.entities.map(toRec)
  while (page.hasNextPage() && out.length < MAX_RESULTS) {
    page = await page.next()
    out.push(...page.entities.map(toRec))
  }
  return out
}

const ofKind = (kind: Kind) => [eq("app", APP), eq("kind", kind)]

export type DistrictFilter = { district: string; minUrgency?: 1 | 2 | 3; item?: Item }

export async function loadDistrict(client: PublicClient, f: DistrictFilter) {
  const d = eq("district", slug(f.district))
  const needWhere = [...ofKind("need"), d, gte("urgency", u64(f.minUrgency ?? 1))]
  if (f.item) needWhere.push(eq("item", f.item))
  const [needs, pledges, receipts, sites, orgs, vouches] = await Promise.all([
    fetchAll(client, needWhere),
    fetchAll(client, [...ofKind("pledge"), d]),
    fetchAll(client, [...ofKind("receipt"), d]),
    fetchAll(client, [...ofKind("site"), d]),
    fetchAll(client, ofKind("org")),
    fetchAll(client, [...ofKind("vouch"), d]),
  ])
  return { needs, pledges, receipts, sites, orgs, vouches, sitesByKey: new Map(sites.map((x) => [x.key, x])) }
}

export const needsInBox = (client: PublicClient, b: Box) =>
  fetchAll(client, [
    ...ofKind("need"),
    gte("lat_e6", u64(toE6(b.south))), lte("lat_e6", u64(toE6(b.north))),
    gte("lng_e6", u64(toE6(b.west))), lte("lng_e6", u64(toE6(b.east))),
  ])

export const myEntities = (client: PublicClient, kind: Kind, owner: Hex) => fetchAll(client, ofKind(kind), { ownedBy: owner })
```
**Step 3:** `scripts/query-smoke.ts` calls `loadDistrict(makePublicClient(), { district: "dhemaji" })` and `needsInBox` for an Assam box, prints counts.

**Step 4: Verify:** `npx tsx scripts/query-smoke.ts` returns without RPC errors (counts may be 0 before seeding). `npx tsc --noEmit` passes. Log any query error (e.g. -32002 / 429) in `arkiv/friction.md`.

**Step 5: Commit** `feat(core): arkiv clients and district/box queries`.

---

### Task 9: Writes

**Files:** Create `src/core/writes.ts`

```ts
import { jsonToPayload, ExpirationTime } from "@arkiv-network/sdk/utils"
import { u64 } from "@arkiv-network/sdk/attr"
import type { Address, Hex } from "viem"
import type { PublicClient, WalletClient } from "./arkiv"
import { assertNoPhone, needAttrs, orgAttrs, pledgeAttrs, receiptAttrs, siteAttrs, vouchAttrs } from "./attrs"
import { needLifetime, needsLeaseRenewal, pledgeExpiry, renewalTarget } from "./expiry"
import { n, type Rec, s } from "./records"
import { type Item, type OrgType, type SiteType, TTL, type Urgency } from "./schema"

const json = (o: object) => ({ payload: jsonToPayload(o), contentType: "application/json" as const })

async function leaseExtensions(pub: PublicClient, currentBlock: bigint, leases: Array<[Hex | undefined, number]>) {
  const out: { entityKey: Hex; expires: ReturnType<typeof ExpirationTime.atBlock> }[] = []
  for (const [k, ttl] of leases) {
    if (!k) continue
    const e = await pub.getEntity(k)
    if (e.expiresAt !== undefined && needsLeaseRenewal(e.expiresAt, currentBlock, ttl)) {
      out.push({ entityKey: k, expires: ExpirationTime.atBlock(renewalTarget(e.expiresAt, currentBlock, ttl)) })
    }
  }
  return out
}

export const registerOrg = (w: WalletClient, o: { name: string; helpline?: string; orgType: OrgType; state: string; district: string }) =>
  w.createEntity({ ...json({ name: o.name, helpline: o.helpline ?? "" }), attributes: orgAttrs(o), expires: ExpirationTime.fromSeconds(TTL.org) })

export const createSite = (w: WalletClient, x: { name: string; landmark?: string; siteType: SiteType; state: string; district: string; lat: number; lng: number; people: number }) =>
  w.createEntity({ ...json({ name: x.name, landmark: x.landmark ?? "" }), attributes: siteAttrs(x), expires: ExpirationTime.fromSeconds(TTL.site) })

export async function postNeed(w: WalletClient, pub: PublicClient, x: { site: Rec; orgKey?: Hex; item: Item; qty: number; urgency: Urgency; note?: string; lifetimeSeconds?: number }) {
  if (x.note) assertNoPhone(x.note)
  const { currentBlock } = await pub.getBlockTiming()
  const extensions = await leaseExtensions(pub, currentBlock, [[x.site.key, TTL.site], [x.orgKey, TTL.org]])
  const lat = Number(n(x.site, "lat_e6")) / 1e6, lng = Number(n(x.site, "lng_e6")) / 1e6
  return w.executeBatch({
    creates: [{
      ...json({ note: x.note ?? "" }),
      attributes: needAttrs({ site: x.site.key, state: s(x.site, "state"), district: s(x.site, "district"), item: x.item, qty: x.qty, urgency: x.urgency, lat, lng }),
      expires: x.lifetimeSeconds ? ExpirationTime.fromSeconds(x.lifetimeSeconds) : needLifetime(x.urgency),
    }],
    extensions,
  })
}

export async function reconfirmNeed(w: WalletClient, pub: PublicClient, need: Rec, orgKey?: Hex) {
  const { currentBlock } = await pub.getBlockTiming()
  const ttl = TTL.need[Number(n(need, "urgency")) as Urgency]
  return w.executeBatch({
    extensions: [
      { entityKey: need.key, expires: ExpirationTime.atBlock(renewalTarget(need.expiresAt, currentBlock, ttl)) },
      ...(await leaseExtensions(pub, currentBlock, [[s(need, "site") as Hex, TTL.site], [orgKey, TTL.org]])),
    ],
  })
}

export async function pledgeTo(w: WalletClient, pub: PublicClient, x: { need: Rec; qty: number; etaUnix: number; note?: string; orgKey?: Hex }) {
  if (x.note) assertNoPhone(x.note)
  const { currentBlock } = await pub.getBlockTiming()
  return w.executeBatch({
    creates: [{
      ...json({ note: x.note ?? "" }),
      attributes: pledgeAttrs({ need: x.need.key, site: s(x.need, "site") as Hex, district: s(x.need, "district"), item: s(x.need, "item") as Item, qty: x.qty, eta: x.etaUnix }),
      expires: pledgeExpiry(x.etaUnix),
    }],
    extensions: await leaseExtensions(pub, currentBlock, [[x.orgKey, TTL.org]]),
  })
}

export async function recordReceipt(w: WalletClient, x: { pledge: Rec; need: Rec }) {
  const delivered = n(x.pledge, "qty")
  const remaining = n(x.need, "qty") - delivered
  const receipt = {
    payload: new Uint8Array(),
    contentType: "application/octet-stream",
    attributes: receiptAttrs({ pledge: x.pledge.key, need: x.need.key, site: s(x.need, "site") as Hex, district: s(x.need, "district"), qty: Number(delivered), pledger: x.pledge.creator }),
    expires: ExpirationTime.fromSeconds(TTL.receipt),
    flags: { readonly: true },
  }
  return remaining > 0n
    ? w.executeBatch({ creates: [receipt], patches: [{ entityKey: x.need.key, set: { qty: u64(remaining) } }] })
    : w.executeBatch({ creates: [receipt], deletes: [{ entityKey: x.need.key }] })
}

export const vouchFor = (w: WalletClient, x: { org: Address; district: string }) =>
  w.createEntity({ payload: new Uint8Array(), contentType: "application/octet-stream", attributes: vouchAttrs(x), expires: ExpirationTime.fromSeconds(TTL.vouch), flags: { readonly: true } })

export const cancelPledge = (w: WalletClient, pledgeKey: Hex) => w.deleteEntity({ entityKey: pledgeKey })
```
**Verify:** `npx tsc --noEmit` passes. Behaviour is verified end-to-end in Task 10. **Commit** `feat(core): batched writes with lease renewal by activity`.

---

### Task 10: Seed the synthetic Assam scenario (integration test)

**Files:** Create `scripts/seed.ts`; gitignored `.seed-wallets.json`

Behaviour:
1. Load `FUNDER_PK`. Create or reuse wallets for roles `authority`, `ngo_brahmaputra`, `ngo_majuli`, `camp_silapathar`, `camp_jonai`, `camp_dhemaji`, `impostor` (keys stored only in `.seed-wallets.json`).
2. Fund each from the funder (amount from Task 2 measurements × 20 writes).
3. Orgs (all names end with "(demo)"): authority = "Dhemaji DDMA (demo)" govt; two NGOs; three camp coordinators (govt/ngo).
4. Sites (public places, synthetic): Silapathar 27.594, 94.723; Jonai 27.828, 95.218; Dhemaji 27.482, 94.580.
5. Authority vouches for both NGOs and all three camp orgs. Impostor is not vouched.
6. Needs: Silapathar clothes 300 (u3), ORS 500 (u2); Jonai food 400 (u2), tarpaulin 80 (u3); Dhemaji water 2000 (u3) + one demo need with `lifetimeSeconds: 180`.
7. Pledges: Brahmaputra → Silapathar clothes 120 (eta +3 h); Majuli → Jonai food 400 (eta +1 h).
8. Receipt: Jonai camp records Majuli's food pledge (need deleted because fully met).
9. Impostor posts a need pointing at the Silapathar site (to demo authenticity rejection).
10. Assert with `loadDistrict` + `computeGaps`: Silapathar clothes gap = 180, Jonai food absent, impostor need excluded. Exit non-zero on mismatch. Print every role address and explorer links.

**Verify:** `npm run seed` ends with `ALL ASSERTIONS PASSED`; explorer shows entities for each address. Record cost and any errors in friction.md.

**Commit** `feat: seed synthetic assam flood scenario with assertions`.

---

### Task 11: CLI

**Files:** Create `cli/abhi.ts`

Commands: `npm run abhi -- gaps <district>` prints a table (site, item, qty, pledged, gap, expires in) using `loadDistrict` + `computeGaps`; `npm run abhi -- need <key>` prints LIVE with remaining time or `EXPIRED / NOT FOUND — do not forward`. Reads Arkiv directly over public RPC (Censorship Resistance evidence: no AbhiChahiye server involved).

**Verify:** after seeding, `npm run abhi -- gaps dhemaji` shows Silapathar clothes gap 180. **Commit** `feat(cli): read gaps straight from arkiv`.

---

### Task 12: Web shell, store, board + map

**Files:** Create `index.html`, `src/web/main.tsx`, `src/web/App.tsx`, `src/web/styles.css`, `src/web/lib/store.tsx`, `src/web/lib/config.ts`, `src/web/pages/Board.tsx`, `src/web/components/NeedCard.tsx`, `src/web/components/MapView.tsx`, `src/web/components/Countdown.tsx`

- `config.ts`: `TRUSTED_AUTHORITIES` (authority address from seed), default district `dhemaji`.
- `store.tsx`: React context holding `loadDistrict` result + `currentBlock` (from `getBlockTiming`), `refresh()`, error state (`can't reach Arkiv — showing data from <time>`), never an empty board on error.
- Board: district select, min-urgency and item filters (re-query Arkiv, i.e. filters are Arkiv predicates, not client filtering), gap list (`computeGaps`) with gap bars, org name from `orgs` by creator, badge "vouched by Dhemaji DDMA (demo)" vs "unverified", countdown from `secondsLeft(expiresAt, currentBlock)`; map markers for sites; moving the map re-queries `needsInBox`.
- Use the frontend-design skill for visual quality (mobile-first, Hindi/Assamese labels alongside English for item names).

**Verify:** `npm run build` passes; `npm run dev` + Playwright MCP snapshot shows seeded needs and the Silapathar clothes gap 180. **Commit** `feat(web): district gap board and map`.

---

### Task 13: Shareable need page

**Files:** Create `src/web/pages/NeedPage.tsx`; modify `App.tsx` (route `/n/:key`)

`getEntity(key)` → if found and `app = abhichahiye`: LIVE card (camp, item, gap, "confirmed by the camp — expires in X"), share button copying a WhatsApp-ready text with the link. If not found or expired: big "EXPIRED — this need is no longer confirmed. Please don't forward." Uses the demo 180 s need to show the flip.

**Verify:** Playwright MCP: open the demo need link → LIVE; after expiry reload → EXPIRED. **Commit** `feat(web): need page that tells forwarders when to stop`.

---

### Task 14: Burner wallets + drip function + camp console

**Files:** Create `src/web/lib/burner.ts`, `api/drip.ts`, `vercel.json`, `src/web/pages/Camp.tsx`

`api/drip.ts`:
```ts
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http, isAddress, parseEther, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" })
  const address = String(req.body?.address ?? "")
  if (!isAddress(address)) return res.status(400).json({ error: "invalid address" })
  const pk = process.env.DRIP_PK as Hex | undefined
  if (!pk) return res.status(503).json({ error: "drip not configured" })
  const amount = parseEther(process.env.DRIP_AMOUNT ?? "0.01")
  const pub = createPublicClient({ chain: tiramisu, transport: http() })
  if ((await pub.getBalance({ address })) >= amount / 2n) return res.status(200).json({ skipped: "already funded" })
  const wallet = createWalletClient({ chain: tiramisu, transport: http(), account: privateKeyToAccount(pk) })
  const hash = await wallet.sendTransaction({ to: address, value: amount })
  return res.status(200).json({ hash })
}
```
`vercel.json`: `{ "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }] }`.

`burner.ts`: per-role key in `localStorage` (`abhichahiye:key:<role>`), `generatePrivateKey()` on first use, `ensureFunded()` POSTs `/api/drip` and falls back to the faucet link. UI states clearly: "Test wallet stored in this browser — testnet only."

Camp console: register org (if `myEntities(org)` empty) → create site → post need (item, qty, urgency, note with phone guard) → list my needs with Re-confirm (`reconfirmNeed`) and incoming pledges with "Received" (`recordReceipt`). Show tx hash + explorer link after each write.

**Verify:** local `vercel dev` (or deployed preview): fresh browser → camp flow creates org, site, need visible on Board. **Commit** `feat(web): burner wallets, drip, camp console`.

---

### Task 15: Donor + authority consoles

**Files:** Create `src/web/pages/Donor.tsx`, `src/web/pages/Authority.tsx`

Donor: pick a gap on the board → pledge qty + ETA (`pledgeTo`) → my pledges list (`myEntities(pledge)`), Cancel (`cancelPledge`), shows expiry = ETA + 2 h. Authority: list orgs in district, Vouch (`vouchFor`); app lets the user add an authority address to their trusted set (stored locally).

**Verify:** Playwright MCP: donor pledge reduces the gap on the board after refresh; vouch flips "unverified" to "vouched". **Commit** `feat(web): donor pledges and authority vouches`.

---

### Task 16: Live updates over WebSocket

**Files:** Create `src/web/lib/live.ts`; modify `store.tsx`

`makeWsClient().watchEntityEvents({ onEvent, onError })` with no `fromBlock`. On `EntityCreated`/`EntityPatched`/`ExpiryExtended`/`EntityDeleted`: if the key is in the current snapshot or (for created) `getEntity(key)` has `app = abhichahiye` and the selected district, patch the store (debounced 500 ms). Local 1 s ticker drops entities whose `secondsLeft` hits 0 (no expiry event exists). Header shows "● live" when the socket is open.

**Verify:** two browser tabs: posting a need in one appears in the other without reload (Playwright MCP). Note any polling fallback in friction.md. **Commit** `feat(web): live board over websocket entity events`.

---

### Task 17: Docs

**Files:** Create `arkiv/schema.md`, `README.md`; finalise `arkiv/friction.md`

- `schema.md`: the data contract (every kind, attribute name/type, payload fields, lifetime rule, flags, every query with exact predicates, trust rules, how a third party builds a WhatsApp bot on it).
- `README.md`: problem with sources, live URL, demo video link, setup (`npm i`, `.env`, `npm run seed`, `npm run dev`), reproduce steps with exact CLI commands, wallet addresses and roles, tracks, pre-existing work: None, LLM used, MIT.
- `friction.md`: each item with surface, versions, expected vs actual, repro, suggested fix; plus "tested paths that worked".

**Verify:** every link resolves; repro steps run clean from a fresh clone (`git clone` to `/tmp`, follow README). **Commit** `docs: schema contract, readme, friction report`.

---

### Task 18: Publish + deploy + smoke

1. `gh repo create s21v1d9p/abhichahiye --public --source . --push` (user confirms the account first).
2. Vercel: user runs `npx vercel login`; agent runs `npx vercel --prod`, sets `DRIP_PK` (separate funded key) and `DRIP_AMOUNT` via `npx vercel env add`.
3. Smoke with Playwright MCP against the production URL in a fresh context: board loads, need page LIVE/EXPIRED, camp flow write succeeds.

**Verify:** screenshots + tx hashes captured. **Commit** any fixes.

---

### Task 19: Submission pack

**Files:** Create `docs/submission.md` (draft answers for all 18 Devfolio questions), `docs/demo-script.md` (≤ 3 min shot list)

Demo beats: problem (Assam 2026 quotes) → board with gaps → camp re-confirms → donor pledges, gap shrinks live in second tab → receipt batch → impostor need rejected → stale link flips to EXPIRED → CLI reads Arkiv without our site → why Arkiv.

User actions: Devfolio registration (Indian nationality = yes, USDC wallet, Telegram), record video, submit form, keep deployment up until 23 Oct. No force-push after the deadline.
