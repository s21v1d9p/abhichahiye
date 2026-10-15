# AbhiChahiye data contract

Everything AbhiChahiye knows lives in **Arkiv entities** on the Tiramisu testnet (chain id `7738577`). No AbhiChahiye server stores or serves this data. Any program that can call the Arkiv RPC can read, verify and extend it without asking us. (The web app has two tiny serverless helpers that hold no data: `/api/drip` gives a new browser wallet a little test GLM, and `/api/rpc` adds our access key to queries once Arkiv's anonymous budget is spent.)

- SDK: `@arkiv-network/sdk` 0.8.1 · RPC: `https://rpc.tiramisu.db-chain.testnet.arkiv.network` · WebSocket: `wss://rpc.tiramisu.db-chain.testnet.arkiv.network`
- Code that builds every attribute below: [`src/core/attrs.ts`](../src/core/attrs.ts) · lifetimes: [`src/core/schema.ts`](../src/core/schema.ts) · queries: [`src/core/queries.ts`](../src/core/queries.ts)

## Conventions

- Every entity carries `app = str('abhichahiye')` and `kind = str('<kind>')`. Always filter on `app`, so other apps on the chain never leak in.
- Attribute names are lowercase `snake_case` (the node rejects uppercase names even though the SDK accepts them; see friction F4).
- Anything you filter on is an attribute. Anything only displayed is in the JSON payload (the payload is not queryable).
- Numbers that need ranges are `u64`. Quantities (`qty`, `people`) are whole numbers from 1 to 10,000,000. Latitude and longitude are stored as degrees × 1,000,000 in `lat_e6` / `lng_e6` (`u64`, so only 0..180 degrees; fine for India).
- District and state values are lowercase slugs (`North Lakhimpur` → `north_lakhimpur`).
- A block is 2 seconds. `expiresAt` is a block number. Time left = `(expiresAt − currentBlock) × 2` seconds, with `currentBlock` from `arkiv_getBlockTiming` (`client.getBlockTiming()`).
- Entity Expiration: every kind has its own lifetime below. Lifetime Extension (`extendEntity`) only ever moves an expiry later; we always ask for a strictly later block.
- No victim names, phone numbers, IDs, household locations, photos or money are ever written. Free text is checked for Indian mobile numbers before it is sent. All demo data is synthetic and labelled `(demo)`.

## Entity kinds

| kind | Created and owned by | Queryable attributes | Payload (JSON, not queryable) | Entity Expiration | Creation flags |
|---|---|---|---|---|---|
| `org` | the organisation's wallet | `org_type` (`govt`/`ngo`/`volunteer`), `state`, `district` | `name`, `helpline` (public number, never a mobile) | 90 days, renewed by activity | none |
| `site` | camp coordinator's wallet | `site_type` (`camp`/`collection`/`kitchen`), `state`, `district`, `lat_e6`, `lng_e6`, `people` (`u64`) | `name`, `landmark` | 7 days, renewed whenever the camp confirms or posts a need | none |
| `need` | the same wallet that created its `site` | `site` (`key`), `state`, `district`, `item`, `qty` (`u64`), `urgency` (`u64`, 1 to 3), `lat_e6`, `lng_e6` | `note` | urgency 3 → 6 h, 2 → 12 h, 1 → 24 h; the camp re-confirms to keep it alive | none |
| `pledge` | a donor or relief group's wallet | `need` (`key`), `site` (`key`), `district`, `item`, `qty` (`u64`), `eta` (`u64`, unix seconds) | `note` | until `eta` + 2 h; `eta` must be in the future and within 48 h | none |
| `receipt` | the wallet that created the need (the camp) | `pledge` (`key`), `need` (`key`), `site` (`key`), `district`, `qty` (`u64`), `pledger` (`addr`) | none | 30 days | `readonly` |
| `vouch` | a district authority's wallet | `org` (`addr`), `district` | none | 30 days | `readonly` |

`item` is one of `water`, `food`, `ors`, `blankets`, `clothes`, `sanitary`, `medicine`, `baby_food`, `tarpaulin`.

### Why each lifetime is what it is

- **need** (6 / 12 / 24 h): a need you can see was confirmed by the camp within its urgency window. Nobody has to remember to close it: if the camp stops re-confirming, the need disappears from every query. This is the point of the product, and it is what stops forwarded WhatsApp lists from going stale.
- **pledge** (until delivery + 2 h): a promise that is never kept stops hiding the gap on schedule. The 48 h ETA limit, which readers enforce as well as writers, stops a pledge from hiding a need for longer than that.
- **site** (7 days, lease): a camp that is still posting stays listed; one that has gone quiet falls off the map.
- **org** (90 days, lease): registrations are renewed by any write the org makes.
- **receipt / vouch** (30 days, `readonly`): evidence is immutable. Receipts give donors a track record, vouches give authorities' endorsements a freshness limit.

### Lease renewal by activity (Lifetime Extension in the same batch)

| Action | One atomic `executeBatch` |
|---|---|
| Post a need | create `need` + extend `site` + extend `org` (only when they have aged by more than an hour) |
| Re-confirm a need | extend `need` + extend `site` + extend `org` |
| Pledge | create `pledge` + extend the donor's `org` |
| Record a delivery | create `receipt` (readonly) + patch `need.qty` down, or delete the `need` if the delivery covers it |

## Queries the app runs

Every `arkiv_query` costs 100 units of the caller's budget, a one-key lookup included (friction F9), so each view is one or two queries and the browser filters and sorts the rest. Shown as the exact string the SDK sends.

1. **District board** (`loadDistrict`). Every kind carries `district`, so one query returns the needs, pledges, receipts, sites, organisations and vouches of a district:
   `app = str('abhichahiye') AND district = str('dhemaji')`
   The urgency and item filters are applied in the browser. If a need's organisation is registered in another district, one more query fetches its name: `app = str('abhichahiye') AND kind = str('org') AND ($creator = addr(0x…) OR …)`.
2. **Verified board** (`loadVerifiedDistrict`), scoped by creator at the query level, so the node never returns entities written by anyone else:
   `app = str('abhichahiye') AND district = str('dhemaji') AND kind = str('vouch') AND ($creator = addr(0xAUTHORITY…) OR …)`, then
   `app = str('abhichahiye') AND district = str('dhemaji') AND ($creator = addr(0xORG1…) OR $creator = addr(0xORG2…) OR …)`, listing the wallets those live vouches name (up to 40).
3. **Map viewport** (`loadBox`). Needs and sites both carry coordinates, so one numeric range query on `u64`:
   `app = str('abhichahiye') AND lat_e6 >= u64(24000000) AND lat_e6 <= u64(29000000) AND lng_e6 >= u64(89000000) AND lng_e6 <= u64(97000000)`
4. **A forwarded need link** (`loadNeed`, two queries at one block). First the need and everything that names it, then its camp listing, its organisation and any vouch for it by a trusted authority:
   `$key = key(0xNEED…) OR app = str('abhichahiye') AND need = key(0xNEED…)`
   `$key = key(0xSITE…) OR app = str('abhichahiye') AND kind = str('org') AND $creator = addr(0xCAMP…) OR app = str('abhichahiye') AND kind = str('vouch') AND org = addr(0xCAMP…) AND ($creator = addr(0xAUTHORITY…))`
5. **Consoles** ([`src/core/consoles.ts`](../src/core/consoles.ts)). A camp reads everything it owns, `app = str('abhichahiye')` with `ownedBy(wallet)` (`$owner = addr(wallet)`), then `app = str('abhichahiye') AND (need = key(0x…) OR …)` for the pledges and receipts naming its needs. A donor reads its pledges the same way, then their needs, sites and receipts in one OR query. A district office reads `app = str('abhichahiye') AND district = str('dhemaji') AND (kind = str('org') OR kind = str('vouch'))`.
6. **Duplicate-receipt guard**, before a camp records a delivery: `app = str('abhichahiye') AND kind = str('receipt') AND pledge = key(0x…)` with `createdBy(camp)`.
7. **Live updates**: `watchEntityEvents` over a WebSocket with no `fromBlock` (a real `eth_subscribe`, not polling). Events are chain-wide and looking an entity up costs a full query, so an event triggers a refresh only if it touches an entity already on screen or comes from a wallet already on screen; anything else is picked up by a refresh every 90 seconds. There is no event when an entity expires, so the UI counts down from `expiresAt` and drops the entity itself.

Pages are 200 entities. Later pages, and later queries of the same view, are pinned (`atBlock`) to the block the first response reports: the SDK's `page.next()` re-queries at the head and the node rejects the cursor once the head has moved (F8), and `getBlockNumber()` is cached for two blocks (F10). A query is capped at 1,000 entities, and the app says when the cap is hit (`truncated`) instead of showing a partial board as if it were complete. Sorting is local, because the node has no server-side ordering.

## Trust rules (all based on the immutable `$creator`, never on a writable attribute)

Anyone can write an entity with any attribute values, including a `site` key that points at somebody else's camp, or a `receipt` that names somebody else's pledge. So the app never believes attributes for authorship:

1. A `need` counts only if its `site` entity is live **and** `site.$creator === need.$creator`.
2. A pledge stops reducing a need's gap only when a `receipt` naming it was created by **the wallet that created that need**. A receipt's own `site` attribute is never consulted: a stranger can create a site of their own and point a receipt at it, so that check would be circular. Only the camp can mark a pledge as received.
3. Pledges are permissionless, so the reader holds each one to the rules `pledgeTo` follows instead of trusting the writer: quantity from 1 to 10,000,000, ETA at most 48 hours ahead, and an Entity Expiration of ETA + 2 hours (with an hour of slack for clock drift). A pledge that outlives its ETA, or promises more than anyone could deliver, is ignored. Writers refuse the same values before sending.
4. An organisation is shown as **vouched** if a live `vouch` with `org = <its wallet>` was created by a wallet the viewer trusts (a configured list of district-authority wallets). Vouches expire after 30 days, so trust has to be renewed.

Implementation: [`src/core/trust.ts`](../src/core/trust.ts), gap arithmetic: [`src/core/gaps.ts`](../src/core/gaps.ts) (gap = need quantity − open pledges, never negative).

### What these rules do not stop

Data on Arkiv is permissionless, so the open board is only as trustworthy as its inputs. A stranger can still create their own camp and needs (they show as unvouched), and can file a plausible-looking pledge that reduces a gap for the hours before its ETA. The need's full quantity and every individual pledge stay visible, and a camp can always see who has promised what. Entities that match a query are limited to 1,000 per query, and the app says when that limit is hit.

The **verified board** closes these gaps for the viewer who wants certainty: because it asks the node only for entities created by wallets a trusted authority vouched for (query 2), spam, impostor camps and hostile pledges cannot reach it, however many of them there are. Its limit is trust itself: it is exactly as good as the authority wallets the viewer chooses to trust, and a vouch lapses after 30 days.

## Building on this data without us

A WhatsApp bot, a district dashboard or a donor app needs only:

```ts
import { createPublicClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { eq, gte } from "@arkiv-network/sdk/query"
import { u64 } from "@arkiv-network/sdk/attr"
import { http } from "viem"

const client = createPublicClient({ chain: tiramisu, transport: http() })
const { currentBlock } = await client.getBlockTiming()
const needs = await client
  .select({ key: true, creator: true, expiresAt: true, attributes: true })
  .where(eq("app", "abhichahiye"), eq("kind", "need"), eq("district", "dhemaji"), gte("urgency", u64(1)))
  .limit(200)
  .fetch()
// Trust a need only if its `site` entity is live and was created by the same wallet (rule 1 above).
// Forward it only while it is live: (expiresAt - currentBlock) * 2 seconds are left.
```

The command-line tool in this repo (`npm run abhi -- gaps dhemaji`) reads Arkiv the same way, applies the trust rules, and never contacts an AbhiChahiye server.

## What stays off Arkiv on purpose

Victims' names, phone numbers and IDs; household locations (only public sites are listed); photos; money and payments; vehicle routing and logistics. Arkiv entities are public forever to anyone with an RPC, so the only data written is what a camp would already announce publicly: what the camp needs, in what quantity, and how urgently.
