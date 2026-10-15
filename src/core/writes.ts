import { u64 } from "@arkiv-network/sdk/attr"
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils"
import type { Address, Hex } from "viem"
import type { PublicClient, WalletClient } from "./arkiv"
import { assertNoPhone, needAttrs, orgAttrs, pledgeAttrs, receiptAttrs, siteAttrs, vouchAttrs } from "./attrs"
import { assertPledgeEta, needLifetime, needsLeaseRenewal, pledgeExpiry, renewalTarget } from "./expiry"
import { fromE6 } from "./geo"
import { liveRec, receiptExists } from "./queries"
import { n, type Rec, s } from "./records"
import { type Item, LIFETIME, type OrgType, type SiteType, type Urgency } from "./schema"

const json = (o: object) => ({ payload: jsonToPayload(o), contentType: "application/json" as const })
const noPayload = { payload: new Uint8Array(), contentType: "application/octet-stream" as const }

// Mobile numbers are personal data and must never reach a public Arkiv entity.
const noPhones = (...texts: Array<string | undefined>) => {
  for (const text of texts) if (text) assertNoPhone(text)
}

type Lease = { key: Hex | undefined; lifetime: number; what: string; required?: boolean }

// A lease is renewed by activity: any write by the owner also extends the entities that prove the owner is still here.
async function leaseExtensions(pub: PublicClient, currentBlock: bigint, leases: Lease[]) {
  const found = await Promise.all(
    leases.map(async (lease) => ({ lease, live: lease.key ? await liveRec(pub, lease.key) : undefined })),
  )
  const extensions: { entityKey: Hex; expires: ReturnType<typeof ExpirationTime.atBlock> }[] = []
  for (const { lease, live } of found) {
    if (!lease.key) continue
    if (!live) {
      if (lease.required) throw new Error(`This ${lease.what} has expired. Register it again first.`)
      continue
    }
    if (needsLeaseRenewal(live.expiresAt, currentBlock, lease.lifetime)) {
      const expires = ExpirationTime.atBlock(renewalTarget(live.expiresAt, currentBlock, lease.lifetime))
      extensions.push({ entityKey: live.key, expires })
    }
  }
  return extensions
}

export async function registerOrg(
  w: WalletClient,
  o: { name: string; helpline?: string; orgType: OrgType; state: string; district: string },
) {
  noPhones(o.name, o.helpline)
  return w.createEntity({
    ...json({ name: o.name, helpline: o.helpline ?? "" }),
    attributes: orgAttrs(o),
    expires: ExpirationTime.fromSeconds(LIFETIME.org),
  })
}

export async function createSite(
  w: WalletClient,
  x: {
    name: string
    landmark?: string
    siteType: SiteType
    state: string
    district: string
    lat: number
    lng: number
    people: number
  },
) {
  noPhones(x.name, x.landmark)
  return w.createEntity({
    ...json({ name: x.name, landmark: x.landmark ?? "" }),
    attributes: siteAttrs(x),
    expires: ExpirationTime.fromSeconds(LIFETIME.site),
  })
}

export async function postNeed(
  w: WalletClient,
  pub: PublicClient,
  x: { site: Rec; orgKey?: Hex; item: Item; qty: number; urgency: Urgency; note?: string; lifetimeSeconds?: number },
) {
  noPhones(x.note)
  const attributes = needAttrs({
    site: x.site.key,
    state: s(x.site, "state"),
    district: s(x.site, "district"),
    item: x.item,
    qty: x.qty,
    urgency: x.urgency,
    lat: fromE6(n(x.site, "lat_e6")),
    lng: fromE6(n(x.site, "lng_e6")),
  })
  const { currentBlock } = await pub.getBlockTiming()
  const extensions = await leaseExtensions(pub, currentBlock, [
    { key: x.site.key, lifetime: LIFETIME.site, what: "camp listing", required: true },
    { key: x.orgKey, lifetime: LIFETIME.org, what: "organisation" },
  ])
  return w.executeBatch({
    creates: [
      {
        ...json({ note: x.note ?? "" }),
        attributes,
        expires: x.lifetimeSeconds ? ExpirationTime.fromSeconds(x.lifetimeSeconds) : needLifetime(x.urgency),
      },
    ],
    extensions,
  })
}

export async function reconfirmNeed(w: WalletClient, pub: PublicClient, need: Rec, orgKey?: Hex) {
  const { currentBlock } = await pub.getBlockTiming()
  // Extend from the expiry on chain, not the caller's snapshot, so a stale view can never ask for a non-extension.
  const live = await liveRec(pub, need.key)
  if (!live) throw new Error("This need has expired. Post it again.")
  const lifetime = LIFETIME.need[Number(n(live, "urgency")) as Urgency]
  const leases = await leaseExtensions(pub, currentBlock, [
    { key: s(live, "site") as Hex, lifetime: LIFETIME.site, what: "camp listing", required: true },
    { key: orgKey, lifetime: LIFETIME.org, what: "organisation" },
  ])
  return w.executeBatch({
    extensions: [
      { entityKey: live.key, expires: ExpirationTime.atBlock(renewalTarget(live.expiresAt, currentBlock, lifetime)) },
      ...leases,
    ],
  })
}

export async function pledgeTo(
  w: WalletClient,
  pub: PublicClient,
  x: { need: Rec; qty: number; etaUnix: number; note?: string; orgKey?: Hex },
) {
  noPhones(x.note)
  assertPledgeEta(x.etaUnix, Math.floor(Date.now() / 1000))
  const attributes = pledgeAttrs({
    need: x.need.key,
    site: s(x.need, "site") as Hex,
    district: s(x.need, "district"),
    item: s(x.need, "item") as Item,
    qty: x.qty,
    eta: x.etaUnix,
  })
  const { currentBlock } = await pub.getBlockTiming()
  const extensions = await leaseExtensions(pub, currentBlock, [
    { key: x.orgKey, lifetime: LIFETIME.org, what: "organisation" },
  ])
  return w.executeBatch({
    creates: [{ ...json({ note: x.note ?? "" }), attributes, expires: pledgeExpiry(x.etaUnix) }],
    extensions,
  })
}

// An honest donor who is running late pushes the ETA back where everyone can see it, instead of letting the pledge lapse.
export async function delayPledge(w: WalletClient, pub: PublicClient, pledge: Rec, newEtaUnix: number) {
  assertPledgeEta(newEtaUnix, Math.floor(Date.now() / 1000))
  const live = await liveRec(pub, pledge.key)
  if (!live) throw new Error("This pledge has already lapsed. Pledge again.")
  if (BigInt(newEtaUnix) <= n(live, "eta")) throw new RangeError("The new ETA must be later than the current one")
  return w.executeBatch({
    patches: [{ entityKey: live.key, set: { eta: u64(BigInt(newEtaUnix)) } }],
    extensions: [{ entityKey: live.key, expires: pledgeExpiry(newEtaUnix) }],
  })
}

// The receipt and the change to the need must land together, so a delivery is never half-recorded.
export async function recordReceipt(w: WalletClient, pub: PublicClient, x: { pledge: Rec; need: Rec }) {
  if (await receiptExists(pub, x.pledge.key, w.account.address)) {
    throw new Error("This delivery is already recorded.")
  }
  const delivered = n(x.pledge, "qty")
  const receipt = {
    ...noPayload,
    attributes: receiptAttrs({
      pledge: x.pledge.key,
      need: x.need.key,
      site: s(x.need, "site") as Hex,
      district: s(x.need, "district"),
      qty: Number(delivered),
      pledger: x.pledge.creator,
    }),
    expires: ExpirationTime.fromSeconds(LIFETIME.receipt),
    flags: { readonly: true },
  }
  const live = await liveRec(pub, x.need.key)
  if (!live) return w.executeBatch({ creates: [receipt] })
  const remaining = n(live, "qty") - delivered
  return remaining > 0n
    ? w.executeBatch({ creates: [receipt], patches: [{ entityKey: live.key, set: { qty: u64(remaining) } }] })
    : w.executeBatch({ creates: [receipt], deletes: [{ entityKey: live.key }] })
}

export async function vouchFor(w: WalletClient, x: { org: Address; district: string }) {
  return w.createEntity({
    ...noPayload,
    attributes: vouchAttrs(x),
    expires: ExpirationTime.fromSeconds(LIFETIME.vouch),
    flags: { readonly: true },
  })
}

export const cancelPledge = (w: WalletClient, pledgeKey: Hex) => w.deleteEntity({ entityKey: pledgeKey })

// A vouch is read-only, so it can never be edited, but its creator can withdraw it at any time.
export const withdrawVouch = (w: WalletClient, vouchKey: Hex) => w.deleteEntity({ entityKey: vouchKey })
