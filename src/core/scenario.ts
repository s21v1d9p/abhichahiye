import { ExpirationTime } from "@arkiv-network/sdk"
import { jsonToPayload } from "@arkiv-network/sdk/utils"
import type { Hex } from "viem"
import type { PublicClient, WalletClient } from "./arkiv"
import { needAttrs } from "./attrs"
import { needLifetime, renewalTarget, secondsLeft } from "./expiry"
import { computeGaps } from "./gaps"
import { fromE6 } from "./geo"
import { liveRec, loadDistrict, myEntities } from "./queries"
import { n, type Rec, s } from "./records"
import { type Item, LIFETIME, type OrgType, type Urgency } from "./schema"
import { trustedOrgs } from "./trust"
import { createSite, delayPledge, pledgeTo, postNeed, reconfirmNeed, recordReceipt, registerOrg, vouchFor } from "./writes"

// A synthetic Assam flood scenario. Every name carries "(demo)". Each step first checks what already exists, so the
// same code seeds a fresh chain, keeps the demo alive when run on a schedule, and can be re-run safely.

export const DISTRICT = "dhemaji"
const STATE = "AS"

export const ROLES = [
  "authority",
  "ngo_brahmaputra",
  "ngo_majuli",
  "camp_silapathar",
  "camp_jonai",
  "camp_dhemaji",
  "impostor",
] as const
export type Role = (typeof ROLES)[number]
export type Wallets = Record<Role, WalletClient>

const ORGS: Record<Role, { name: string; helpline?: string; orgType: OrgType }> = {
  authority: { name: "Dhemaji DDMA (demo)", helpline: "1077", orgType: "govt" },
  ngo_brahmaputra: { name: "Brahmaputra Relief Trust (demo)", orgType: "ngo" },
  ngo_majuli: { name: "Majuli Youth Relief (demo)", orgType: "ngo" },
  camp_silapathar: { name: "Silapathar Camp Committee (demo)", orgType: "govt" },
  camp_jonai: { name: "Jonai Camp Committee (demo)", orgType: "ngo" },
  camp_dhemaji: { name: "Dhemaji Town Camp Committee (demo)", orgType: "govt" },
  impostor: { name: "Dhemaji Flood Fund (demo)", orgType: "ngo" },
}

type CampRole = "camp_silapathar" | "camp_jonai" | "camp_dhemaji"
const CAMPS: Record<CampRole, { name: string; landmark: string; lat: number; lng: number; people: number }> = {
  camp_silapathar: { name: "Silapathar relief camp (demo)", landmark: "school ground", lat: 27.594, lng: 94.723, people: 420 },
  camp_jonai: { name: "Jonai relief camp (demo)", landmark: "college ground", lat: 27.828, lng: 95.218, people: 310 },
  camp_dhemaji: { name: "Dhemaji relief camp (demo)", landmark: "stadium", lat: 27.482, lng: 94.58, people: 560 },
}

type NeedSpec = { item: Item; qty: number; urgency: Urgency; note?: string }
const NEEDS: Record<CampRole, NeedSpec[]> = {
  camp_silapathar: [
    { item: "clothes", qty: 300, urgency: 3, note: "Adult sizes S to XL; people arrived with nothing dry" },
    { item: "ors", qty: 500, urgency: 2 },
  ],
  camp_jonai: [{ item: "tarpaulin", qty: 80, urgency: 3, note: "Roofs of 40 shelters leak" }],
  camp_dhemaji: [{ item: "water", qty: 2000, urgency: 3, note: "Litres of packaged drinking water" }],
}

// The keepalive runs on GitHub's schedule, which in practice arrives hours apart (we measured gaps of 3 to 5 hours on
// an hourly cron). So a demo need is re-confirmed once a tenth of its lifetime has passed, and the demo pledge keeps
// its arrival 4 to 6 hours ahead: everything survives a gap of about 5 hours without changing its key.
const RECONFIRM_BELOW = 0.9
const PLEDGE_HOURS = 6
const PLEDGE_DELAY_BELOW_HOURS = 4

export type ScenarioOptions = { log?: (message: string) => void; demoExpiry?: boolean }
export type Check = { name: string; ok: boolean; detail: string }

const mine = (pub: PublicClient, kind: Parameters<typeof myEntities>[1], w: WalletClient) =>
  myEntities(pub, kind, w.account.address)
const unix = () => Math.floor(Date.now() / 1000)

async function must(pub: PublicClient, key: Hex): Promise<Rec> {
  const found = await liveRec(pub, key)
  if (!found) throw new Error(`entity ${key} was written but cannot be read back`)
  return found
}

export async function runScenario(pub: PublicClient, w: Wallets, options: ScenarioOptions = {}): Promise<void> {
  const log = options.log ?? (() => {})

  const orgs = {} as Record<Role, Rec>
  for (const role of ROLES) {
    const [existing] = await mine(pub, "org", w[role])
    if (existing) {
      orgs[role] = existing
    } else {
      const { entityKey } = await registerOrg(w[role], { ...ORGS[role], state: STATE, district: DISTRICT })
      orgs[role] = await must(pub, entityKey)
      log(`registered ${ORGS[role].name}`)
    }
  }

  const sites = {} as Record<CampRole, Rec>
  for (const role of Object.keys(CAMPS) as CampRole[]) {
    const [existing] = await mine(pub, "site", w[role])
    if (existing) {
      sites[role] = existing
    } else {
      const { entityKey } = await createSite(w[role], { ...CAMPS[role], siteType: "camp", state: STATE, district: DISTRICT })
      sites[role] = await must(pub, entityKey)
      log(`listed ${CAMPS[role].name}`)
    }
  }

  const vouched = new Set((await mine(pub, "vouch", w.authority)).map((v) => s(v, "org")))
  for (const role of ROLES.filter((r) => r !== "authority" && r !== "impostor")) {
    const org = w[role].account.address
    if (!vouched.has(org.toLowerCase())) {
      await vouchFor(w.authority, { org, district: DISTRICT })
      log(`DDMA vouched for ${ORGS[role].name}`)
    }
  }

  for (const role of Object.keys(NEEDS) as CampRole[]) {
    const existing = await mine(pub, "need", w[role])
    for (const spec of NEEDS[role]) {
      const found = existing.find((x) => s(x, "item") === spec.item)
      if (!found) {
        await postNeed(w[role], pub, { site: sites[role], orgKey: orgs[role].key, ...spec })
        log(`${CAMPS[role].name}: needs ${spec.qty} ${spec.item}`)
      } else if (secondsLeft(found.expiresAt, await pub.getBlockNumber()) < LIFETIME.need[spec.urgency] * RECONFIRM_BELOW) {
        await reconfirmNeed(w[role], pub, found, orgs[role].key)
        log(`${CAMPS[role].name}: re-confirmed ${spec.item}`)
      }
    }
  }

  await keepClothesPledge(pub, w, orgs)
  await playJonaiStory(pub, w, sites, orgs, log)
  await ensureImpostorNeed(pub, w, sites.camp_silapathar, log)

  if (options.demoExpiry) {
    const existing = await mine(pub, "need", w.camp_dhemaji)
    if (!existing.some((x) => s(x, "item") === "sanitary")) {
      await postNeed(w.camp_dhemaji, pub, {
        site: sites.camp_dhemaji,
        orgKey: orgs.camp_dhemaji.key,
        item: "sanitary",
        qty: 150,
        urgency: 3,
        note: "Demo need: lapses by itself in three minutes",
        lifetimeSeconds: 180,
      })
      log("Dhemaji camp: posted a need that lapses in 3 minutes")
    }
  }
}

// Brahmaputra Relief Trust has promised 120 clothes for Silapathar. While the demo runs it keeps that promise alive by
// pushing its ETA back, which is exactly what an honest donor who is running late would do.
async function keepClothesPledge(pub: PublicClient, w: Wallets, orgs: Record<Role, Rec>): Promise<void> {
  const need = (await mine(pub, "need", w.camp_silapathar)).find((x) => s(x, "item") === "clothes")
  if (!need) return
  const [pledge] = (await mine(pub, "pledge", w.ngo_brahmaputra)).filter((p) => s(p, "need") === need.key)
  if (!pledge) {
    await pledgeTo(w.ngo_brahmaputra, pub, {
      need,
      qty: 120,
      etaUnix: unix() + PLEDGE_HOURS * 3600,
      note: "One truck from Dibrugarh",
      orgKey: orgs.ngo_brahmaputra.key,
    })
  } else if (Number(n(pledge, "eta")) - unix() < PLEDGE_DELAY_BELOW_HOURS * 3600) {
    await delayPledge(w.ngo_brahmaputra, pub, pledge, unix() + PLEDGE_HOURS * 3600)
  }
}

// Jonai asks for food, Majuli Youth Relief promises all of it, the camp confirms it arrived, and the need is closed.
async function playJonaiStory(
  pub: PublicClient,
  w: Wallets,
  sites: Record<CampRole, Rec>,
  orgs: Record<Role, Rec>,
  log: (message: string) => void,
): Promise<void> {
  const majuli = w.ngo_majuli.account.address.toLowerCase()
  if ((await mine(pub, "receipt", w.camp_jonai)).some((r) => s(r, "pledger") === majuli)) return

  const findNeed = async () => (await mine(pub, "need", w.camp_jonai)).find((x) => s(x, "item") === "food")
  let need = await findNeed()
  if (!need) {
    await postNeed(w.camp_jonai, pub, {
      site: sites.camp_jonai,
      orgKey: orgs.camp_jonai.key,
      item: "food",
      qty: 400,
      urgency: 2,
      note: "Dry rations for 310 people",
    })
    need = (await findNeed())!
    log("Jonai relief camp: needs 400 food")
  }
  let [pledge] = (await mine(pub, "pledge", w.ngo_majuli)).filter((p) => s(p, "need") === need!.key)
  if (!pledge) {
    await pledgeTo(w.ngo_majuli, pub, { need, qty: 400, etaUnix: unix() + 3600, orgKey: orgs.ngo_majuli.key })
    ;[pledge] = (await mine(pub, "pledge", w.ngo_majuli)).filter((p) => s(p, "need") === need!.key)
    log("Majuli Youth Relief: pledged 400 food")
  }
  await recordReceipt(w.camp_jonai, pub, { pledge: pledge!, need })
  log("Jonai relief camp: recorded the delivery, need closed")
}

// A stranger copies Silapathar's real site key into a need of their own. Nothing stops them writing it, or keeping it
// alive: like a real impostor it re-posts the same need, so its key stays the same and the documented link to it keeps
// showing the rejection. It extends only its own need; it cannot touch the camp's listing. Its need is the longest-lived
// kind (24 hours), so the documented key survives even a long gap between keepalive runs.
const IMPOSTOR_URGENCY = 1

async function ensureImpostorNeed(pub: PublicClient, w: Wallets, site: Rec, log: (message: string) => void): Promise<void> {
  const [existing] = await mine(pub, "need", w.impostor)
  const lifetime = LIFETIME.need[IMPOSTOR_URGENCY]
  if (existing) {
    const { currentBlock } = await pub.getBlockTiming()
    if (secondsLeft(existing.expiresAt, currentBlock) < lifetime * RECONFIRM_BELOW) {
      const expires = ExpirationTime.atBlock(renewalTarget(existing.expiresAt, currentBlock, lifetime))
      await w.impostor.extendEntity({ entityKey: existing.key, expires })
      log("impostor: kept its need alive")
    }
    return
  }
  await w.impostor.createEntity({
    payload: jsonToPayload({ note: "Send water for Silapathar camp" }),
    contentType: "application/json",
    attributes: needAttrs({
      site: site.key,
      state: STATE,
      district: DISTRICT,
      item: "water",
      qty: 999,
      urgency: IMPOSTOR_URGENCY,
      lat: fromE6(n(site, "lat_e6")),
      lng: fromE6(n(site, "lng_e6")),
    }),
    expires: needLifetime(IMPOSTOR_URGENCY),
  })
  log("impostor: wrote a need that points at Silapathar's real camp")
}

// What a fresh look at the chain must show once the scenario has run.
export async function assertScenario(pub: PublicClient, w: Wallets): Promise<Check[]> {
  const data = await loadDistrict(pub, { district: DISTRICT })
  const gaps = computeGaps(data.needs, data.pledges, data.receipts, data.sitesByKey, { nowUnix: unix(), block: data.block })
  const wallet = (role: Role) => w[role].account.address.toLowerCase()
  const gapOf = (role: Role, item: string) => gaps.find((g) => g.need.creator === wallet(role) && s(g.need, "item") === item)
  const checks: Check[] = []
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

  const clothes = gapOf("camp_silapathar", "clothes")
  check("Silapathar clothes: 300 needed, 120 pledged, gap 180", clothes?.qty === 300n && clothes.pledged === 120n && clothes.gap === 180n, `qty ${clothes?.qty} pledged ${clothes?.pledged} gap ${clothes?.gap}`)
  check("Silapathar ORS need is live", gapOf("camp_silapathar", "ors")?.qty === 500n, `qty ${gapOf("camp_silapathar", "ors")?.qty}`)
  check("Jonai tarpaulin need is live", gapOf("camp_jonai", "tarpaulin")?.qty === 80n, `qty ${gapOf("camp_jonai", "tarpaulin")?.qty}`)
  check("Dhemaji water need is live", gapOf("camp_dhemaji", "water")?.qty === 2000n, `qty ${gapOf("camp_dhemaji", "water")?.qty}`)
  check("Jonai food is closed after the recorded delivery", gapOf("camp_jonai", "food") === undefined, gapOf("camp_jonai", "food") ? "still on the board" : "absent")
  const receipts = data.receipts.filter((r) => r.creator === wallet("camp_jonai"))
  check("Jonai camp's receipt is on chain", receipts.length >= 1, `${receipts.length} receipt(s)`)

  const forged = data.needs.filter((x) => x.creator === wallet("impostor"))
  const shown = gaps.some((g) => g.need.creator === wallet("impostor"))
  check("the impostor's need is on chain but rejected", forged.length >= 1 && !shown, `${forged.length} written, shown on board: ${shown}`)

  const trusted = trustedOrgs(data.vouches, [w.authority.account.address])
  const vouchedRoles = ROLES.filter((r) => trusted.has(wallet(r) as Hex))
  const expected = ["ngo_brahmaputra", "ngo_majuli", "camp_silapathar", "camp_jonai", "camp_dhemaji"]
  check("the authority vouches for both NGOs and all three camps, not the impostor", expected.every((r) => vouchedRoles.includes(r as Role)) && !vouchedRoles.includes("impostor"), vouchedRoles.join(", "))
  return checks
}
