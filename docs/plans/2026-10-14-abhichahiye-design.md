# AbhiChahiye (अभी चाहिए, "needed right now") — Design

Date: 2026-10-14 · Challenge: Arkiv Global Tour Stop (9–18 Oct 2026) · Network: Tiramisu (chain 7738577) · SDK `@arkiv-network/sdk` 0.8.1

Tracks: Best Indian Use Case · Censorship Resistance · Open Source · Security

## 1. Problem

Flood relief in India keeps failing the same way: many groups, no shared, *current* picture of what each camp still needs.

- Assam floods, Aug 2026: three relief vehicles converged on one area carrying rice and pulses that people already had; they needed clothes — "there was no coordination at all" (Hindustan Times, 8 Aug 2026). "Multiple groups sometimes converged on the same locations, while other affected areas remained underserved" (Assam Tribune, 12 Aug 2026). ~2,000 relief vehicles/day left plastic-waste piles in Sivasagar and Charaideo (Assam Tribune, 11 Aug 2026).
- Scale, Q3 2026: Bihar 50.49 lakh affected (NIE, 23 Sep); Odisha 8.64 lakh affected, >1 lakh in >500 relief centres (DD News 4 Aug, HT 28 Sep); Kerala >27,000 in ~460 camps (IE, 5 Aug).
- Precedents: Chennai 2015 aid "piling up" in warehouses (IE, 10 Dec 2015); Kerala 2018 keralarescue.in had no way to mark requests "done" (GitHub issue biswaz/rescuekerala#18, still open) and forwarded helpline lists that no one answered (Caravan, 6 Oct 2018); Covid 2021 "verified leads" were stale within hours (Newslaundry, 7 May 2021).
- Existing 2026 tools (banpani.org, Helpmonk, Jal Raksha) are single-operator needs maps with no expiry, no pledge tracking and no verifiable authorship; banpani.org returned HTTP 522 on 14 Oct 2026.

Users: relief-camp coordinators (government and NGO), relief groups and donors deciding what to load into the next vehicle, district disaster-management staff, volunteers forwarding requests on WhatsApp.

## 2. Core idea — lifetime is the truth

A need you can see on AbhiChahiye was confirmed by the camp itself within its urgency window. Nobody has to remember to close it: if the camp stops re-confirming, the need expires on Arkiv. A pledge exists only until its promised delivery time, so a ghost pledge reopens the gap on schedule. Trust is fresh too: vouches expire.

## 3. Data model (Arkiv entities)

All entities carry `app = "abhichahiye"` and `kind`. Attribute names are lowercase snake_case (node rejects uppercase). Numbers that need ranges are `u64`.

| kind | Owner / creator | Attributes (queryable) | Payload (not queryable) | Expiration | Flags |
|---|---|---|---|---|---|
| `org` | the org wallet | `org_type` (govt/ngo/volunteer), `state`, `district` | name, public helpline, website | 90 days; extended in the same batch as any write by the org (lease renewed by activity) | — |
| `site` | camp coordinator wallet | `site_type` (camp/collection/kitchen), `state`, `district`, `lat_e6`, `lng_e6` (u64, degrees × 1e6), `people` (u64) | name, landmark, public helpline | 7 days; extended whenever the camp confirms a need (camp open = alive) | — |
| `need` | camp coordinator wallet | `site` (entity key), `state`, `district`, `item`, `qty` (u64), `urgency` (u64 1–3), `lat_e6`, `lng_e6` | note | urgency 3 → 6 h, 2 → 12 h, 1 → 24 h; re-confirm = `extendEntity` by the camp | — |
| `pledge` | donor / relief-group wallet | `need` (key), `site` (key), `district`, `item`, `qty` (u64), `eta` (u64 unix s) | vehicle/route note (no personal data) | `atDate(eta + 2 h)`; donor may extend (explicit, visible delay) or delete (cancel) | — |
| `receipt` | camp coordinator wallet | `pledge` (key), `need` (key), `site` (key), `qty` (u64), `pledger` (addr) | — | 30 days | readonly |
| `vouch` | district-authority wallet | `org` (addr), `district` | — | 30 days | readonly |

What deliberately stays off Arkiv: victims' names, phone numbers and IDs; household locations (only public sites); photos; money and payments; routing/logistics. All demo data is synthetic.

## 4. Queries the app runs

1. Gap board for a district: `app = abhichahiye AND kind = need AND district = D AND urgency >= U` (+ optional `item = I`).
2. Map viewport: `kind = need AND lat_e6 >= a AND lat_e6 <= b AND lng_e6 >= c AND lng_e6 <= d`.
3. Live pledges for the visible needs: `kind = pledge AND district = D`; coverage = Σ live pledge qty without a receipt, per need.
4. Trusted view: same queries restricted to `$creator` in the set of orgs with a live `vouch` from a trusted district-authority wallet (`createdBy` / `$creator` equality).
5. A camp's own needs: `ownedBy(campWallet) AND kind = need`.
6. Donor track record: `kind = receipt AND pledger = X`, counted only when receipt `$creator` equals the site's `$creator`.

Pagination uses cursors pinned to one block; sorting happens client-side (no server-side order).

## 5. Writes and atomicity

- Post / re-confirm a need: batch { create or extend `need`, extend `site`, extend `org` }.
- Record a delivery: batch { create `receipt`, patch `need.qty` }, both owned by the camp. The donor's pledge is not deletable by the camp; the gap view treats a pledge with a receipt as fulfilled.
- Pledge: create `pledge` (+ extend donor `org`).

## 6. Live updates

`watchEntityEvents` over a WebSocket transport, no `fromBlock`. Events are chain-wide, so the client fetches each new/changed key and keeps those with `app = abhichahiye`. There is no expiry event, so the UI runs a local countdown from `$expiresAt` and drops entities when they lapse.

## 7. Architecture

Single TypeScript repo, no application backend:

- `src/core/` — schema constants, attribute builders, expiry policy, query builders, gap computation, trust filter. Shared by web, CLI, seed script.
- `src/web/` — Vite + React app: district gap board, map (Leaflet + OSM), camp console, donor console, shareable need page (`/n/<key>` shows LIVE or "EXPIRED — don't forward").
- `cli/` — `abhi gaps --district <d>` reads Arkiv directly (proves the data is usable without our site).
- `scripts/seed.ts` — synthetic Assam flood scenario (district authority, 2 NGOs, 3 camps, needs, pledges, receipts).
- `api/drip.ts` — Vercel function that sends a small amount of test GLM to a fresh in-browser burner wallet so judges can write without asking for access. Funding key lives only in a Vercel env var. It never touches Arkiv data.

Wallets: per-role burner keys generated in the browser and kept in localStorage (testnet only; documented).

## 8. Error handling

- RPC failure or HTTP 429: show "can't reach Arkiv — data not refreshed" with last-refresh time; never show an empty board as "no needs".
- Extension that would not move expiry later: compute target as `max(now + ttl, current + 2 blocks)`.
- Drip failure: show the Arkiv faucet link.

## 9. Testing

- Unit (vitest): expiry policy, attribute encoding, gap/coverage computation, trust filter, receipt validity.
- Integration: seed script on Tiramisu followed by assertions on the queries above.
- Smoke: Playwright against the deployed URL (board loads, need page shows LIVE/EXPIRED).

## 10. Judging map

- Why India: named users (camp coordinators, relief groups, district DM staff), Q3 2026 evidence above; works today for any group with a browser.
- Why Arkiv: no shared operator across government/NGOs; expiry as protocol guarantee; `$creator` authorship; readable from any RPC when a site is down.
- How we use Arkiv: per-type lifetimes with product meaning, lease renewal by activity, numeric range queries, `$creator` trust filter, atomic batches, WebSocket events.
- Friction: logged continuously in `arkiv/friction.md` with versions and repro steps.
