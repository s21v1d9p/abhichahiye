# Friction report: building AbhiChahiye on Arkiv

What got in our way, and what worked, while building AbhiChahiye (a relief-needs board whose needs expire unless the camp keeps confirming them) on the Tiramisu testnet, 14 to 15 October 2026. Every issue below was reproduced on the live network. Nothing here is a guess.

Two scripts in this repo reproduce it:

| Command | What it does | Needs |
|---|---|---|
| `npm run friction` | Re-checks F1 to F10 and W1 against Tiramisu. Writes are only simulated with `eth_call` from a throwaway key. Exits 0 only if every issue still behaves as written here. | Nothing (an `ARKIV_KEY` in `.env` is used only if the public budget runs out) |
| `npm run probe` | Sends 10 real transactions from a fresh wallet and records hashes, gas, timings and the live events seen. Output: [`docs/evidence/probe.json`](../docs/evidence/probe.json). | `FUNDER_PK` with about 0.01 test GLM |

Last full run of `npm run friction`: **10/10 checks behaved as documented** (Tiramisu block 605715, 15 Oct 2026).

## Environment

| | |
|---|---|
| SDK | `@arkiv-network/sdk` 0.8.1 (its TypeScript source ships in the package; file references below are to `node_modules/@arkiv-network/sdk/src`) |
| viem | 2.57.7 |
| Runtime | Node.js 22.20.0, TypeScript 7.0.2, tsx 4.23; Chrome 154 for the browser findings |
| Network | Tiramisu, chain id 7738577, `https://rpc.tiramisu.db-chain.testnet.arkiv.network`, 2-second blocks |
| Challenge docs | `Arkiv-Network/global-tour-stop-pre-devcon` at commit `4f912d1` (AGENTS.md) |

## Summary

| # | Surface | What happened | Cost to us | Suggested fix |
|---|---|---|---|---|
| F9 | Public RPC, SDK | An anonymous client gets a small query budget (each query costs 100 units). When it runs out, the RPC answers 429 with `Retry-After: 2046`, and the SDK waits that out silently: our page hung with no error. Nothing documents the budget or the cost. | **High**: the deployed board would have frozen for every judge after a few minutes | Document the budget and per-method cost; make the SDK fail fast with a typed error |
| F10 | SDK chain definition | `tiramisu` has no `blockTime`, so viem caches `getBlockNumber()` for 4 s. Queries pinned to it right after a write read the state before the write. | Medium: stale cards after every action | Add `blockTime: 2_000` to the chain |
| F11 | Query index | A query sent just after a write resolves can still miss it (377 ms in our probe). | Low | Return the block in write results; document read-your-writes |
| F8 | SDK pagination | `page.next()` fails with `-32005` once the chain head has moved (every 2 s), so any result over 200 entities failed intermittently. | Medium | Make `next()` reuse the first page's block |
| F3 | SDK errors | A wallet with no GLM gets `Execution error without revert data`; the cause, `gas required exceeds: 0`, is five errors down. | Medium: the first thing every new user hits | Check the balance, or map that error to "fund this wallet" |
| F4 | SDK validation | Uppercase attribute names pass SDK validation, then the engine refuses them; the SDK's decoded message says `"Q"` is outside a charset that lists `"A"-"Z"`. | Low | Lowercase-only name check; fix the message |
| F1 | Docs vs SDK | Challenge docs say to range-filter on `$createdAt`; the SDK refuses to build that filter, while the node accepts it. | Low | Allow `$createdAt` in the SDK |
| F2 | SDK query builder | `ne()`, `exists()` and `hasType()` are exported, but the node rejects them (`-32002`). | Low | Gate or document per network |
| F5 | Docs vs engine | Docs say Lifetime Extension "reverts if the new one is not later"; extending to the **same** expiry is accepted (and charged gas). | Low | Correct the docs, or reject the no-op |
| F12 | Docs | Two pages disagree on whether an access key may be used from a browser. | Low: we built a proxy to be safe | One consistent recommendation |
| F7 | SDK README | The install snippet shows `"@arkiv-network/sdk": "^0.6.0"` for 0.8.1. | Low | Update the snippet |

What worked, tested with the same rigour, is in [Paths that worked](#paths-that-worked): atomic batches, exact Entity Expiration, read-only entities, decoded reverts, live events over WebSocket, nested query predicates, pinned pagination, and the faucet and access-key flow.

---

## F9. The anonymous query budget is undocumented, and the SDK hangs on it

**Surface:** public JSON-RPC endpoint; TypeScript SDK (through viem's HTTP transport).

**Expected.** The Access Keys page says: *"You do not need a key to try Arkiv. The public RPC works without one, at the default rate limit."* The SDK's querying page says the default endpoint *"is heavily rate limited and meant for testing."* We expected a request rate limit we could stay under, and an error if we did not.

**Actual.**

1. Every `arkiv_query` carries the response header `arkiv-cost: 100`, whatever it returns. `getEntity` is an `arkiv_query` too (`src/actions/public/getEntity.ts` sends `$key = key(…)`), so looking one entity up costs as much as reading a whole district. `eth_blockNumber` and `eth_getBalance` carry no cost header. This is only visible in raw response headers.
2. Besides the per-minute limit (`ratelimit: limit=600, remaining=…, reset=…` on every response), an anonymous client has a cost budget. When it is spent, every query is refused:

   ```
   HTTP/2 429
   ratelimit: limit=10000, remaining=0, reset=2046
   retry-after: 2046
   {"error":"ANON_COST_LIMITED","message":"unauthenticated query budget exhausted; get an API key at https://hub.arkiv.network for a monthly quota"}
   ```

   10,000 units at 100 per query is about **100 queries** before a pause of up to 34 minutes. (Seen in Chrome on 15 Oct at 15:40 IST; a Node client on the same machine later got `Retry-After: 858`.) We could not work out how clients are told apart: from the same IP, Chrome was refused while `curl` still got answers.
3. viem honours `Retry-After` when it retries (`viem/utils/buildRequest.ts`: `const retryAfter = error?.headers?.get('Retry-After')`). So `await client.select(…).fetch()` simply waits 2,046 seconds per retry. Our camp page sat on "Reading your camp from Arkiv…" for more than four minutes with no error, no log and no failed promise.

How we spent the budget: our live-update code looked up every chain-wide `EntityCreated` event with `getEntity` to see whether it belonged to us. During the probe, 133 entities were created chain-wide in 80 seconds, so that alone cost roughly 10,000 units a minute.

**Versions:** SDK 0.8.1, viem 2.57.7, Chrome 154 and Node 22.20.0.

**Steps to reproduce.**

```sh
# The cost header (cheap; this is check F9 of npm run friction):
curl -si https://rpc.tiramisu.db-chain.testnet.arkiv.network -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["app = str('"'"'abhichahiye'"'"')",{"limit":"0x1"}]}' | grep -i -E 'arkiv-cost|ratelimit'
```

```ts
// The budget and the hang: about 100 anonymous queries from one browser, then one more.
for (let i = 0; i < 110; i++) await client.select({ key: true }).where(eq("app", "x")).limit(1).fetch()
await client.select({ key: true }).where(eq("app", "x")).limit(1).fetch() // never resolves for ~34 min
```

**What we did.**
- Built every view from one or two queries instead of four to six: a whole district is a single query on the `district` attribute, a map viewport one range query, a forwarded need link two ([`src/core/queries.ts`](../src/core/queries.ts)).
- Live events no longer look anything up; they only count if they touch an entity or wallet already on screen ([`src/web/lib/live.ts`](../src/web/lib/live.ts)).
- A custom `fetchFn` reads the public endpoint first and, when a query gets a 429, moves queries to a fallback until the budget resets: in scripts the keyed URL, in the browser our `/api/rpc`, which adds the key on the server and forwards nothing but `arkiv_query`. With no fallback it throws `ArkivQuotaError` at once instead of waiting ([`src/core/arkiv.ts`](../src/core/arkiv.ts), [`api/rpc.ts`](../api/rpc.ts)).
- Only `arkiv_query` is blocked. From a browser whose budget was spent we measured `eth_blockNumber`, `eth_chainId` and `eth_getBalance` all answering 200 while `arkiv_query` answered 429 `ANON_COST_LIMITED`. Our first version moved every call to the fallback after the first 429, so the proxy refused the `eth_*` calls with 403. Only the deployed site showed this, because the scripts' keyed URL accepts every method. Now only `arkiv_query` changes endpoint, and a test pins that down.
- Verified by forcing every public query to 429 in Playwright: the board still loaded in 1.8 s through the fallback.

**Suggested fix.**
1. Document the anonymous budget next to the "default rate limit": units per window, window length, what each method costs, and how clients are identified.
2. In the SDK, treat a 429 with `ANON_COST_LIMITED` (or any long `Retry-After`) as a typed error, for example `QuotaExceededError { retryAfter }`, instead of inheriting viem's wait.
3. Expose the cost per call (for example `page.cost`), so developers can see it before they hit the wall.
4. Consider a cheaper single-key lookup, or a batch `getEntities(keys)`.

## F10. `getBlockNumber()` is cached for two blocks, so fresh writes look missing

**Surface:** SDK chain definition `@arkiv-network/sdk/chains` (`tiramisu`), with viem's client defaults.

**Expected.** `client.getBlockNumber()` returns the current block, so pinning follow-up queries to it (`.atBlock(n)`) gives a fresh and consistent snapshot.

**Actual.** The `tiramisu` chain has no `blockTime`, so viem falls back to a 4,000 ms `pollingInterval`, and `getBlockNumber()` caches for that long (`client.cacheTime === 4000`). On a chain with 2-second blocks that is two blocks. Measured: `getBlockNumber()` returned 605724, and 605724 again three seconds later, while the head was 605725. Our camp console read its page at that cached block right after a camp marked a delivery as received, and showed the need **before** the delivery.

**Versions:** SDK 0.8.1, viem 2.57.7.

**Steps to reproduce:** check F10 of `npm run friction`, or:

```ts
import { tiramisu } from "@arkiv-network/sdk/chains"
const client = createPublicClient({ chain: tiramisu, transport: http() })
console.log(tiramisu.blockTime, client.cacheTime) // undefined 4000
const a = await client.getBlockNumber(); await new Promise((r) => setTimeout(r, 3000))
const b = await client.getBlockNumber() // b === a, though a block or two has passed
```

**What we did.** Views no longer ask for the block number. They pin later queries to the block the first query's response reports (`page.blockNumber`), which is always fresh ([`fetchAll` in `src/core/queries.ts`](../src/core/queries.ts)); a regression test asserts it.

**Suggested fix.** Add `blockTime: 2_000` to the `tiramisu` chain definition, so viem's polling and caching match the chain.

## F11. A query right after a write can still miss it

**Surface:** query index behind the JSON-RPC endpoint.

**Expected.** `createEntity` resolves only after the transaction receipt (`src/actions/wallet/createEntity.ts` waits for it), so we expected an immediate query to see the entity.

**Actual.** In the probe, `createEntity` resolved after 3,722 ms, and a query by `$creator` first returned the entity **377 ms later**.

**Steps to reproduce:** `npm run probe`, check P2 (it polls every 250 ms after `createEntity` resolves and reports how long the entity took to appear).

**What we did.** After every console write we read the transaction receipt's block and re-read the page until the block the query reports is at least that block ([`src/web/lib/writer.ts`](../src/web/lib/writer.ts)). The "written" status only appears once the page shows the result.

**Suggested fix.** Include `blockNumber` in the SDK's write results, and document the pattern "query until `page.blockNumber >= receipt.blockNumber`".

## F8. `page.next()` fails once the chain head moves

**Surface:** SDK cursor pagination.

**Expected.** The SDK documents cursors as bound to one query, block and selection; we expected `page.next()` to fetch page two of the same snapshot.

**Actual.** `page.next()` re-runs the query at the current head. If a block has passed since page one (blocks are 2 s apart), the node refuses the cursor: `QueryError (-32005) "cursor belongs to a different query, block or select — start a new page-through"`. Any query with more than 200 results failed intermittently.

**Steps to reproduce:** check F8 of `npm run friction` (it waits 5 s between pages, then repeats with `.atBlock()` pinned, which works).

**What we did.** `fetchAll` pins every page to the block of the first one and passes the cursor itself ([`src/core/queries.ts`](../src/core/queries.ts)).

**Suggested fix.** Have `page.next()` reuse `page.blockNumber` as `atBlock`.

## F3. An unfunded wallet gets an error that does not mention funds

**Surface:** SDK write errors.

**Expected.** A clear "this wallet has no GLM" (every new user starts here).

**Actual.** `EntityMutationError: Transaction failed: Execution error without revert data`. The real cause, `out of gas: gas required exceeds: 0`, is five `cause`s down the chain.

**Steps to reproduce:** check F3 of `npm run friction` (`createEntity` from a freshly generated key).

**What we did.** Our UI looks through the whole cause chain and says "This wallet has no test GLM yet" ([`src/web/lib/tx.ts`](../src/web/lib/tx.ts)). New browser wallets are topped up automatically before their first write ([`api/drip.ts`](../api/drip.ts)).

**Suggested fix.** Check the balance before estimating gas, or map `gas required exceeds: 0` to an `InsufficientFundsError` that links the faucet.

## F4. Uppercase attribute names: accepted by the SDK, refused by the engine, with a self-contradicting message

**Surface:** SDK attribute-name validation (`src/attr/names.ts`).

**Expected.** If the engine only accepts lowercase names, the SDK's local check refuses uppercase too, before anything is signed.

**Actual.** The SDK's rule is `NAME_RE = /^[A-Za-z][A-Za-z0-9._-]*$/`, so `Qty` passes. The engine then refuses it during gas estimation (`Ident32InvalidByte`, selector `0x276f7798`), and the SDK's decoded message reads: `an attribute name holds "Q" (0x51) at byte 0, which is outside the name charset ("A"-"Z", "a"-"z", "0"-"9", ".", "-" and "_", with a letter first)`. The charset it quotes includes the letter it rejects. Nothing is sent and no gas is spent.

**Steps to reproduce:** check F4 of `npm run friction` (simulated), or probe step F4 (real estimation).

**What we did.** All our attribute names are lowercase `snake_case`; the in-memory engine we test against refuses uppercase the same way ([`src/core/memchain.ts`](../src/core/memchain.ts)).

**Suggested fix.** Make `NAME_RE` lowercase-only and correct the charset in the message.

## F1. `$createdAt`: advertised, refused by the SDK, supported by the node

**Surface:** challenge docs (AGENTS.md line 28) and the SDK query builder.

**Expected.** AGENTS.md: *"There is no server-side ordering (no `orderBy`); sort on the client, or range-filter on `$createdAt`."*

**Actual.** `gte("$createdAt", u64(n))` throws `InvalidPredicateError` (the SDK only allows `$key`, `$owner`, `$creator` and `$expiresAt`). The same filter sent as a raw query string works: `$createdAt >= u64(605558) AND $createdAt <= u64(605558)` returned 2 entities, and a far-future bound returned 0.

**Steps to reproduce:** check F1 of `npm run friction`.

**Suggested fix.** Add `$createdAt` to the SDK's filterable system attributes (the node already supports it).

## F2. `ne()`, `exists()` and `hasType()` are exported but refused

**Surface:** SDK query builder against the Tiramisu node.

**Expected.** Operators exported from `@arkiv-network/sdk/query` work on the default network.

**Actual.** All three fail with `QueryError -32002` ("A predicate uses an operator the node does not support for that type"). `startsWith()` and `not(eq())` work.

**Steps to reproduce:** check F2 of `npm run friction`.

**What we did.** Used `not(eq())` and positive filters only.

**Suggested fix.** Document per-network operator support, or refuse these operators client-side with a clear message.

## F5. Extending to the same expiry is accepted, not reverted

**Surface:** challenge docs (AGENTS.md line 31) vs the engine.

**Expected.** AGENTS.md: *"Lifetime Extension (`extendEntity`) **sets** a new expiry; it reverts if the new one is not later."*

**Actual.** Extending to exactly the current expiry is accepted: real transaction [`0x2257233a…`](https://tiramisu.explorer.arkiv.network/tx/0x2257233a045463a5f55cc880fecf4a0f3a3a10a9f9f1f6f457948ac3b8fa2a04) succeeded, used 25,240 gas and changed nothing. One block earlier reverts with `ExpiryNotExtended` (`0x33268a0d`), and the SDK explains it well (see W5).

**Steps to reproduce:** check F5 of `npm run friction` (simulated as the owner of a live entity), or probe step F5 (real transaction).

**What we did.** Our renewals always ask for a strictly later block ([`renewalTarget` in `src/core/expiry.ts`](../src/core/expiry.ts)).

**Suggested fix.** Change the docs to "reverts if the new one is earlier", or make the engine reject the no-op so nobody pays for it.

## F12. Two pages disagree about access keys in browsers

**Surface:** docs.

**Expected.** One recommendation for using an access key in a web app.

**Actual.** The Access Keys page offers an **Origins** allowlist: *"List the websites that can use the key from a browser."* The SDK querying page says: *"Keep that key on a server, because anyone who opens your website can read it from the network request."*

**What we did.** Followed the stricter advice: the key lives only in the server-side `/api/rpc` function, which forwards `arkiv_query` and nothing else, and browsers use it only after the public endpoint refuses them (F9). Our production bundle contains no key (checked by searching `dist/`).

**Suggested fix.** State one pattern, for example "browser keys are for attribution only; use a server proxy for quota you care about".

## F7. The README install snippet is two minor versions behind

**Surface:** `node_modules/@arkiv-network/sdk/README.md`.

**Expected.** `npm install @arkiv-network/sdk` shown with the version you get.

**Actual.** The README (lines 83 to 90) shows `"@arkiv-network/sdk": "^0.6.0"` and `"viem": "^2.38.2"`; the installed version is 0.8.1. On 0.x, `^0.6.0` does not accept 0.8.

**Steps to reproduce:** check F7 of `npm run friction`.

**Suggested fix.** Generate the snippet from `package.json` at release time.

---

## Paths that worked

Tested the same way: what we did, what we expected, what happened. Transactions are on the [explorer](https://tiramisu.explorer.arkiv.network); all from the throwaway probe wallet [`0x005d6FAb…A662`](https://tiramisu.explorer.arkiv.network/address/0x005d6FAbEd8ecF4b4F282a9Af88Bb6B89484A662).

| # | Tested | Expected | Happened | Evidence |
|---|---|---|---|---|
| W1 | Cursor pagination with `.atBlock()` pinned for the whole walk | Distinct entities, one block | 3 pages over 7.5 s, 600 distinct keys, all at block 605715 | `npm run friction` (W1) |
| W2 | One `executeBatch` with a create, a patch and a Lifetime Extension | All or nothing, one transaction | One transaction: qty patched 180 → 120, expiry +300 blocks, new entity created; 145,416 gas | [`0x93981220…`](https://tiramisu.explorer.arkiv.network/tx/0x93981220c9e813f35967afe1689ae318e64b05ff2c265599f25f8118a14acd71), probe P4 |
| W3 | Entity Expiration with a 10-second lifetime | Gone at `expiresAt`, with no cleanup job | `getEntity` stopped finding it 11 s after creation, at the expiry block; queries never returned it again | [`0x63a0c240…`](https://tiramisu.explorer.arkiv.network/tx/0x63a0c2408a4f994ac59eddcbc84e948fd90f208c4eeb92935ec77f2374a4d0b7), probe P10 |
| W4 | Read-only entities (our receipts and vouches) | Contents immutable | Patch refused before sending; **extension and deletion allowed**, so an authority can withdraw a vouch | [`0x6b0cde3c…`](https://tiramisu.explorer.arkiv.network/tx/0x6b0cde3cb44617e175ab8ea912e084f277060e25d114f7ac5832b7f9ef52ed2b), [`0xe7280df1…`](https://tiramisu.explorer.arkiv.network/tx/0xe7280df1a5f05396c8d45f6dde3725e8fe8b2cbb7e31c1d6eca4457a7d246e7f), probe P8 |
| W5 | Engine reverts | A readable reason | The SDK decodes them into sentences, for example `entity 0x4fe85a7d…6dd037 already expires at block 604296, so extending it to 604295 would shorten its life`, and `…was created readonly, so its contents can never change. Its expiry can still be extended, and it can be transferred or deleted`. We show these to users as they are. | probe P6, P8b |
| W6 | `watchEntityEvents` over WebSocket, no `fromBlock` | A real subscription with every mutation | 11 events for our entities, of all four kinds, among 133 chain-wide; **no event when an entity expires** (so the UI counts down from `expiresAt` itself) | probe P11 |
| W7 | Nested predicates in one query | AND/OR nesting, numeric ranges on `u64` | `app AND district` returned a whole district (23 entities of six kinds) in one query; `$key = … OR (app AND need = …)` returned a need with its pledges; 40 `$creator` clauses in one OR worked; `lat_e6`/`lng_e6` ranges power the map | [`src/core/queries.ts`](../src/core/queries.ts) |
| W8 | Writes simulated with `eth_call` from an unfunded key | The engine evaluates the real write | It does: every write shape we use was accepted, and bad ones reverted with the right selector, before we had any GLM. `npm run friction` uses this for F4 and F5. | [`scripts/friction-repro.ts`](../scripts/friction-repro.ts) |
| W9 | Faucet and access key | Tokens and a key | Faucet: 10 GLM per claim after a human check. Key: wallet sign-in, email, captcha; 1,000,000 units a month; both `/<key>` in the path and `X-API-KEY` work, and keyed responses add `arkiv-quota-used-percent` | used throughout |
| W10 | A brand-new wallet funded by our drip | Usable at once | Funded and confirmed in 3.7 s, then wrote straight away | probe P1 |

### What writes cost (real receipts, 1 gwei)

| Operation | Gas used | Cost in test GLM |
|---|---:|---:|
| `createEntity` | 95,512 | 0.0000955 |
| `createEntity`, read-only | 95,288 | 0.0000953 |
| `patchEntity` (one attribute) | 45,128 | 0.0000451 |
| `executeBatch` (create + patch + extend) | 145,416 | 0.0001454 |
| `extendEntity` | 25,240 | 0.0000252 |
| `deleteEntity` | 24,510 | 0.0000245 |

Re-confirming a need is one `extendEntity` (0.0000252 test GLM), plus the camp's site and organisation leases when they are renewed in the same batch. The demo keepalive re-confirms each need roughly once an hour, which comes to a few thousandths of a test GLM per camp per day; the seed tops a demo wallet up from the funder only when it falls below 0.02.

## The one thing to improve first

**F9.** Publish the anonymous query budget and the cost per method, and make the SDK fail fast with a typed error when the budget is gone. It decides whether a public web app built on the default endpoint works for its users at all, and today a developer only finds out when their page silently stops loading.
