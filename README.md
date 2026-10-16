# AbhiChahiye (अभी चाहिए, "needed right now")

**Flood-relief needs that disappear unless the camp confirms them again, and that only the camp itself can write.**
Built on [Arkiv](https://arkiv.network), the Web3 database, on the Tiramisu testnet.

- **Live app:** https://abhichahiye.vercel.app (no sign-up, works on a phone; a test wallet is created and funded for you on your first write)
- **Data contract:** [`arkiv/schema.md`](arkiv/schema.md) · **Friction report:** [`arkiv/friction.md`](arkiv/friction.md)
- **Read the data without us:** `npm run abhi -- gaps dhemaji`, or the `curl` in [Reproduce it](#reproduce-it)

## The problem

When a flood hits, help arrives from everywhere at once: the district administration, NGOs, volunteer groups and neighbourhood WhatsApp groups. Each keeps its own list of what the camps need. Nobody owns a shared, current picture, so the lists go stale within hours and keep being forwarded long after.

It happened again this year:

- **Assam, August 2026.** In Jorhat, a volunteer saw three relief vehicles heading to the same area, carrying mainly rice and pulses, while the people there needed clothes: "there was no coordination at all" ([Hindustan Times, 8 Aug 2026](https://www.hindustantimes.com/india-news/tech-to-the-rescue-new-apps-aid-relief-rehabilitation-of-assam-s-floodaffected-101786168718389.html)). "Multiple groups sometimes converged on the same locations, while other affected areas remained underserved" ([The Assam Tribune, 12 Aug 2026](https://assamtribune.com/assam/from-chaos-to-coordination-how-technology-is-reshaping-flood-relief-in-assam-1615563)). Locals estimated that nearly 2,000 relief vehicles a day were arriving in some of the worst-hit areas, and plastic waste piled up in villages of Sivasagar and Charaideo ([The Assam Tribune, 11 Aug 2026](https://assamtribune.com/assam/flood-relief-rush-leaves-upper-assam-villages-grappling-with-plastic-waste-1615486)).
- **The scale, July to September 2026.** In Bihar, 50.49 lakh people were affected in 15 districts ([New Indian Express, 23 Sep 2026](https://www.newindianexpress.com/states/bihar/2026/Sep/23/over-50-lakh-affected-in-bihar-floods-as-576-panchayats-in-15-districts-remain-inundated)). In Odisha, 8.64 lakh were affected across 22 districts in early August ([DD News, 4 Aug 2026](https://ddnews.gov.in/en/odisha-floods-over-8-6-lakh-affected-across-22-districts-2-67-lakh-evacuated/)), and in a second flood in late September more than 1 lakh people were moved to over 500 relief centres ([DD News, 28 Sep 2026](https://ddnews.gov.in/en/odisha-cm-tours-flood-hit-districts-as-govt-moves-over-1-lakh-people-to-relief-camps/)). In Kerala, more than 27,000 people were sheltering in about 460 relief camps ([The Indian Express, 5 Aug 2026](https://indianexpress.com/article/explained/explained-climate/kerala-floods-explained-silted-rivers-wetlands-10819189/)).

And it is not new:

- **Chennai, 2015.** With no proper distribution network, "much of the aid materials is piling up" ([The Indian Express, 10 Dec 2015](https://indianexpress.com/article/india/india-news-india/chennai-floods-new-challenges-1-lakh-in-relief-camps-gaps-in-aid-network/)).
- **Kerala, 2018.** The volunteer-built rescue site had no way to show that a request for help was done. The issue asking for it, "There should be some way to know that a request for help is Done/On way", is still open ([biswaz/rescuekerala#18](https://github.com/biswaz/rescuekerala/issues/18)). A rescue volunteer described the WhatsApp version of the same problem: a forward with 15 numbers, and "You called 10 numbers and none of them answered" ([The Caravan, 6 Oct 2018](https://caravanmagazine.in/vantage/how-social-media-was-vital-to-rescue-efforts-during-the-kerala-floods)).
- **Covid, 2021.** Crowd-sourced lists of beds and oxygen: "information often becomes obsolete within hours" ([Newslaundry, 20 Apr 2021](https://www.newslaundry.com/2021/04/20/twitter-is-a-covid-helpline-now-what-does-it-say-about-indias-healthcare-systems)).

The missing piece is the same each time: a list that says, by itself, whether it is still true, and who wrote it.

## Who uses it, and what changes for them

| Who | Today | With AbhiChahiye |
|---|---|---|
| **Relief-camp coordinators** (district-run and NGO-run camps) | Post a list once on WhatsApp; it is forwarded for days after the need is met | Post a need with an urgency. It stays visible only while they keep pressing **Still needed: confirm again** (every 6, 12 or 24 hours). When they stop, it vanishes everywhere by itself |
| **Relief groups and donors** loading the next vehicle | Guess from forwarded lists; three vehicles bring rice and pulses to the same area while people there need clothes | See what each camp still lacks **after** what others have promised. A pledge carries an arrival time and reopens the gap by itself if the vehicle never arrives |
| **District disaster-management staff** | Cannot tell a real camp's request from an impostor's | Vouch for real organisations from their wallet. The **Vouched only** board shows nothing else, and a vouch lapses after 30 days unless renewed |
| **Anyone forwarding a request** | Cannot tell whether a forwarded list is still true | Opens the link: it says **Live · confirmed by the camp** with the time left, or **This need is no longer confirmed. Don't forward.**, or **This post was not written by the camp it names.** |

It works for them today: a phone browser, item names in English, Hindi and Assamese, a **Share on WhatsApp** button on every need, and no account or app to install. Personal mobile numbers are refused in every free-text field, because everything on Arkiv is public.

## Reproduce it

**1. In the browser** (https://abhichahiye.vercel.app). The demo scenario is a synthetic flood in Dhemaji district, Assam: one district authority, two NGOs, three camps and one impostor.

1. **Board:** four live needs, each with a countdown. Toggle **Vouched only**, open the **Map** tab.
2. **Open a need** (e.g. Silapathar's clothes): the gap is 300 asked − 120 promised. The page shows who wrote it, on the explorer.
3. **I run a camp:** register an organisation, list a camp, post a need, then press **confirm again** and watch the timer reset. Each step is one Arkiv transaction signed by a test wallet in your browser. Use a district such as `Testpur` to keep the demo board clean.
4. **I'm donating:** open your need, pledge part of it, and see the gap shrink. Back in the camp console, mark it **Received**: the receipt and the reduced need land in one atomic batch.
5. **District office:** vouch for an organisation. Your vouch is a real read-only entity, but the badges count only vouches from the authority wallets this site trusts (the demo Dhemaji DDMA), and the page says so: whoever reads the data chooses which authorities to trust.

**2. From a terminal, with no AbhiChahiye server involved:**

```sh
git clone https://github.com/s21v1d9p/abhichahiye && cd abhichahiye && npm ci
npm run abhi -- gaps dhemaji          # what the camps still need, after pledges
npm run abhi -- need 0xe2b6f82fb53e96569bf407a65521603563d586692264a4b19eab3a931caa2e10   # LIVE, exit code 0
npm run abhi -- need 0xfd651bfaba340da5a49cd7f7a99501050041b7d13f39350604ccedd0aa70cb98   # closed by a delivery: EXPIRED / NOT FOUND, exit code 2
npm run abhi -- need 0xdcedcf96a7e7dd61cf4ef008127bf8c9bd7be9212f3d4b1991c4e0677f49c9a0   # NOT WRITTEN BY ITS CAMP, exit code 2
```

```text
Camp                           Item       Urgency  Needs  Pledged  Still short  Expires in  Confirmed by
Dhemaji relief camp (demo)     water      3        2000   0        2000         4h 12m      0xffef…d7dc
Silapathar relief camp (demo)  clothes    3        300    120      180          4h 12m      0x2b8e…adf1
Jonai relief camp (demo)       tarpaulin  3        80     0        80           4h 12m      0x576f…6248
Silapathar relief camp (demo)  ors        2        500    0        500          10h 12m     0x2b8e…adf1
```

**3. The exact query, as raw JSON-RPC:**

```sh
curl -s https://rpc.tiramisu.db-chain.testnet.arkiv.network -H 'content-type: application/json' --data \
'{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["app = str('"'"'abhichahiye'"'"') AND kind = str('"'"'need'"'"') AND district = str('"'"'dhemaji'"'"')",{"select":{"key":true,"creator":true,"expiresAt":true,"attributes":true},"limit":"0x14"}]}'
```

It returns five needs, not four. One of them (`0xdcedcf96…`) names Silapathar's camp in its `site` attribute, but its `$creator` (`0x8d2a…`, the impostor) is not the wallet that created that camp (`0x2b8e…`). Every reader in this repo rejects it, using only `$creator`, which nobody can forge ([trust rules](arkiv/schema.md#trust-rules-all-based-on-the-immutable-creator-never-on-a-writable-attribute)).

The demo keys above stay the same while the keepalive runs. If one ever reads EXPIRED, `npm run abhi -- gaps dhemaji --json` prints the keys of the live needs, and this query lists every need, the impostor's included.

If the endpoint answers `ANON_COST_LIMITED`, your network has spent Arkiv's anonymous query budget (every query costs 100 units; see [F9](arkiv/friction.md)). Wait for the `Retry-After`, or create a free access key on the [Hub](https://hub.arkiv.network) and put it after the URL (`…testnet.arkiv.network/<key>`). The CLI does this itself when `ARKIV_KEY` is set.

## Why Arkiv

What breaks on anything else:

- **A database that one operator controls (Postgres, Firebase, our own API).** Relief here is many organisations, and none of them will run on another's server. Single-operator sites are also exactly what fail: they go down mid-flood, or they are abandoned when the water recedes, along with the data. And even when they run, they cannot prove who wrote an entry: the operator can edit or forge any row.
- **IPFS.** Content-addressed data cannot expire or change, so a pinned list of needs stays "true" forever. That is the stale-list problem itself. There is also nothing to query by district, item or urgency.
- **A subgraph.** We would write and deploy contracts and still run (or pay for) an indexer, which is an operator again, and still have no expiry.

What we rely on, and what would fall apart without it:

1. **Entity Expiration is the product.** A need you can see was confirmed by its camp within its urgency window. When the camp stops confirming, the need disappears from **every** reader at once: our site, the CLI, and anyone else's bot. Nobody has to remember to close it, and no cron job has to run. With a normal database, expiry is a promise the operator has to keep.
2. **`$creator` is authorship nobody can forge.** A need counts only if the wallet that created its camp created it too. A delivery counts only if the camp itself wrote the receipt. Authorities vouch from their own wallets. No field anyone can write is trusted.
3. **Open, queryable data with no gatekeeper.** Typed attributes let anyone query by district, item, urgency or map area over plain JSON-RPC ([building on this data without us](arkiv/schema.md#building-on-this-data-without-us)). If our site disappears, the data does not.

**What stays off Arkiv on purpose:** victims' names, phone numbers and IDs; household locations (only public sites); photos; money and payments; vehicle routing. Everything on Arkiv is public to anyone with an RPC, so we write only what a camp would announce publicly anyway. All demo data is synthetic and labelled `(demo)`.

## How we use Arkiv

Every feature below changes something the user sees.

| Arkiv feature | How we use it, and why | What the user sees | Code |
|---|---|---|---|
| **Entity Expiration**, per kind | `need` 6 / 12 / 24 h by urgency; `pledge` until arrival + 2 h; `site` 7 days; `org` 90 days; `receipt` and `vouch` 30 days | A countdown on every need; an expired link says so; an unkept promise stops hiding the gap | [`schema.ts`](src/core/schema.ts), [`expiry.ts`](src/core/expiry.ts) |
| **Lifetime Extension** as a lease renewed by activity | Confirming a need extends it, and extends the camp's `site` and `org` in the same batch. A donor who is running late extends the pledge | **Still needed: confirm again** resets the timer; quiet camps fall off the map | [`writes.ts`](src/core/writes.ts) `reconfirmNeed`, `delayPledge` |
| **Batch writes** | Post a need = create `need` + extend `site` + extend `org`. Record a delivery = create `receipt` + reduce (or delete) the `need`. Atomic, so a gap never shows half an update | The gap shrinks in one step when a delivery is received | [`writes.ts`](src/core/writes.ts) `postNeed`, `recordReceipt` |
| **Attributes vs payload** | Everything filtered is a typed attribute: `qty`, `urgency`, `eta`, `people`, `lat_e6`, `lng_e6` are `u64` for ranges; keys use `key`, wallets `addr`. Names and notes stay in the JSON payload | Filters by urgency and item; the map | [`attrs.ts`](src/core/attrs.ts) |
| **Queries** | A whole district in one query; a numeric range query per map viewport; `$creator` OR-lists for the verified board; `createdBy()` for the consoles; cursor pagination pinned to one block | Board, map, **Vouched only**, consoles | [`queries.ts`](src/core/queries.ts), [`consoles.ts`](src/core/consoles.ts) |
| **`$creator`** | Every trust decision (see above). We deliberately never trust `$owner`: an owner can hand an entity to any wallet without asking | "This post was not written by the camp it names", the **Vouched** badge, "Received ✓" only when the camp says so | [`trust.ts`](src/core/trust.ts) |
| **Creation flags** | `receipt` and `vouch` are created `readonly`: evidence cannot be edited after the fact | A recorded delivery or a vouch can be withdrawn, but never quietly changed | [`writes.ts`](src/core/writes.ts) `recordReceipt`, `vouchFor` |
| **WebSocket entity events** | `watchEntityEvents` over a WebSocket, no `fromBlock`. An event refreshes the view only if it touches an entity on screen or comes from a wallet on screen, because looking anything else up costs a full query | The board updates by itself when a camp on it confirms or posts a need; anything else appears within 90 seconds | [`live.ts`](src/web/lib/live.ts) |
| **Delete** | Cancel a pledge; withdraw a vouch; close a need that a delivery fully covered | Withdrawn promises vanish at once | [`writes.ts`](src/core/writes.ts) |

Most views cost one or two `arkiv_query` calls, because every query spends 100 units of the caller's budget ([F9](arkiv/friction.md)). Reads go to the public endpoint first; only after it refuses a query with 429 does the browser send queries through [`api/rpc.ts`](api/rpc.ts), which adds our access key on the server and forwards `arkiv_query` and nothing else.

## Tracks

- **Best Indian Use Case:** the users, problem and evidence above.
- **Security:** every page shows and filters entities by `$creator`. A forged need, a receipt from someone other than the camp, or a vouch from an untrusted wallet changes nothing a reader sees. Readers also hold every entity to the rules our own writers follow (known types, quantities, urgency and coordinates in range, text payload fields only), so a stranger's malformed entity is skipped instead of breaking or freezing the page ([`shape.ts`](src/core/shape.ts), [`hostile.test.ts`](src/core/hostile.test.ts)).
- **Censorship Resistance:** if our site is taken down, blocked or abandoned, the board still exists: the CLI and the `curl` above read it straight from Arkiv, and the static frontend can be hosted by anyone.
- **Open Source:** MIT code and a documented data contract ([`schema.md`](arkiv/schema.md)), with the trust rules and a code snippet, so another team can build a WhatsApp bot or a district dashboard on the same entities without asking us.

## On-chain evidence (Tiramisu)

The demo wallets and their roles. The explorer lists every entity each one created and the creation transactions.

| Role | Address |
|---|---|
| District authority: Dhemaji DDMA (demo), vouches | [`0xAF4326E72570237fF4541C4c4E64E22F43da2C0e`](https://tiramisu.explorer.arkiv.network/address/0xAF4326E72570237fF4541C4c4E64E22F43da2C0e) |
| NGO: Brahmaputra Relief Trust (demo), pledges | [`0xB00866E053d17Db4694d187500ABb098309B88Af`](https://tiramisu.explorer.arkiv.network/address/0xB00866E053d17Db4694d187500ABb098309B88Af) |
| NGO: Majuli Youth Relief (demo), pledges | [`0x671bb19595e37E4910f0cbB6aB54Ef06021a1A61`](https://tiramisu.explorer.arkiv.network/address/0x671bb19595e37E4910f0cbB6aB54Ef06021a1A61) |
| Camp: Silapathar relief camp (demo), posts needs | [`0x2B8e9CD0B6976bA0E38B63A6083a973Fcb5Badf1`](https://tiramisu.explorer.arkiv.network/address/0x2B8e9CD0B6976bA0E38B63A6083a973Fcb5Badf1) |
| Camp: Jonai relief camp (demo), posts needs and recorded the delivery that closed one | [`0x576f371767db39e53cA58EC74cFbd65b187b6248`](https://tiramisu.explorer.arkiv.network/address/0x576f371767db39e53cA58EC74cFbd65b187b6248) |
| Camp: Dhemaji relief camp (demo), posts needs | [`0xFFEF4dEb42a1E9b070B800E26aE52CA795a4d7dc`](https://tiramisu.explorer.arkiv.network/address/0xFFEF4dEb42a1E9b070B800E26aE52CA795a4d7dc) |
| Impostor: Dhemaji Flood Fund (demo), writes a need in Silapathar's name to show it being rejected | [`0x8d2A3BE8F9c58212C38486AE6eccC843f40bBd55`](https://tiramisu.explorer.arkiv.network/address/0x8d2A3BE8F9c58212C38486AE6eccC843f40bBd55) |
| Funder (tops up the demo wallets; writes no entities) | [`0xAe0a347474596E103458cEc04AE7075fe706F46a`](https://tiramisu.explorer.arkiv.network/address/0xAe0a347474596E103458cEc04AE7075fe706F46a) |
| Test-GLM drip for browser wallets (writes no entities) | [`0x475FD3a23Fa2F0E875E5D434877Fde7F02b3b127`](https://tiramisu.explorer.arkiv.network/address/0x475FD3a23Fa2F0E875E5D434877Fde7F02b3b127) |
| Probe wallet ([`npm run probe`](scripts/probe.ts), [evidence](docs/evidence/probe.json)) | [`0x005d6FAbEd8ecF4b4F282a9Af88Bb6B89484A662`](https://tiramisu.explorer.arkiv.network/address/0x005d6FAbEd8ecF4b4F282a9Af88Bb6B89484A662) |

Visitors' browser wallets create entities too; each console links its own wallet on the explorer.

**These needs are kept alive on purpose, and disclosed.** A GitHub Action ([`keepalive.yml`](.github/workflows/keepalive.yml)) runs the idempotent seed, so the demo camps confirm their needs the way a real camp would and the board is not empty when you look. It is scheduled four times an hour, because GitHub delivers scheduled runs irregularly (we measured gaps of 3 to 5 hours on an hourly schedule), and each run re-confirms whatever has aged. It uses the same `extendEntity` calls as the app and bypasses nothing; the impostor keeps re-posting its forged need the same way. If it stops, every need lapses within 6 to 24 hours. The seed also asserts the scenario on chain each run (8 checks: gaps after pledges, the closed need, the receipt, the rejected impostor, the vouches).

## Run it yourself

Requires Node 22.9 or newer.

```sh
npm ci
npm test            # unit and scenario tests on an in-memory chain that mirrors the SDK, so they need no network
npm run dev         # http://localhost:5173 against Tiramisu (add ?mem to use the in-memory chain instead)
npm run abhi -- gaps <district>   # the CLI
npm run friction    # re-runs the friction report's reproductions against Tiramisu
```

Optional `.env` (never commit it): `ARKIV_KEY` (a Hub access key, used only server-side once the anonymous query budget is spent), `DRIP_PK` (a funded test wallet for `/api/drip`), `FUNDER_PK` (for `npm run seed` and `npm run probe`, which write to Tiramisu). Get test GLM at https://hub.arkiv.network/faucet.

```
src/core/     data contract, writes, queries, trust rules, gap maths (shared by web, CLI and scripts)
src/web/      Vite + React app: board, map, need page, camp / donor / district consoles
src/server/   test-GLM drip and the query-only access-key proxy
api/          the two Vercel functions that wrap src/server
cli/          npm run abhi
scripts/      seed (also the keepalive), probe, friction repro
arkiv/        schema.md, friction.md
```

## Honest notes

- Testnet only. Browser wallets hold free test GLM and live in `localStorage`; every write is public.
- The verified board is exactly as good as the authority wallets a viewer trusts. The open board shows everything, labelled.
- Hindi and Assamese labels were machine-assisted; corrections are welcome.
- **Pre-existing work:** none. Everything here was written between 14 and 18 October 2026, starting from [`f0b7cd0`](https://github.com/s21v1d9p/abhichahiye/commit/f0b7cd0).
- **AI assistance:** built with Claude (Anthropic) through GitHub Copilot CLI, for design, code, tests, reviews and docs. Every claim about Arkiv's behaviour was measured on Tiramisu ([`docs/evidence/probe.json`](docs/evidence/probe.json), `npm run friction`).

## Licence

[MIT](LICENSE)
