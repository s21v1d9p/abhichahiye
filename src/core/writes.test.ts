import { NoEntityFoundError } from "@arkiv-network/sdk"
import { describe, expect, it, vi } from "vitest"
import type { Hex } from "viem"
import type { PublicClient, WalletClient } from "./arkiv"
import { blocksFor } from "./expiry"
import type { Rec } from "./records"
import { LIFETIME } from "./schema"
import { cancelPledge, createSite, pledgeTo, postNeed, reconfirmNeed, recordReceipt, registerOrg, vouchFor } from "./writes"

const CAMP = `0x${"c".repeat(40)}` as Hex
const DONOR = `0x${"d".repeat(40)}` as Hex
const SITE_KEY = `0x${"a".repeat(64)}` as Hex
const NEED_KEY = `0x${"b".repeat(64)}` as Hex
const PLEDGE_KEY = `0x${"e".repeat(64)}` as Hex
const ORG_KEY = `0x${"f".repeat(64)}` as Hex
const BLOCK = 1000n

const rec = (key: Hex, creator: Hex, attrs: Record<string, string | bigint>, expiresAt: bigint): Rec => ({
  key,
  creator,
  owner: creator,
  expiresAt,
  attrs,
  payload: {},
})

const fresh = (lifetimeSeconds: number) => BLOCK + blocksFor(lifetimeSeconds)
const aged = (lifetimeSeconds: number) => BLOCK + blocksFor(lifetimeSeconds / 4)

const siteAttrs = { state: "as", district: "dhemaji", lat_e6: 27594000n, lng_e6: 94723000n }
const needAttrs = { site: SITE_KEY, ...siteAttrs, item: "clothes", qty: 300n, urgency: 3n }
const siteRec = (expiresAt: bigint) => rec(SITE_KEY, CAMP, siteAttrs, expiresAt)
const needRec = (expiresAt: bigint, qty = 300n) => rec(NEED_KEY, CAMP, { ...needAttrs, qty }, expiresAt)
const orgRec = (expiresAt: bigint) => rec(ORG_KEY, CAMP, { kind: "org" }, expiresAt)
const pledgeRec = (qty: bigint) =>
  rec(PLEDGE_KEY, DONOR, { need: NEED_KEY, site: SITE_KEY, district: "dhemaji", item: "clothes", qty }, 9n)

const asEntity = (r: Rec) => ({
  key: r.key,
  creator: r.creator,
  owner: r.owner,
  expiresAt: r.expiresAt,
  attributes: Object.fromEntries(
    Object.entries(r.attrs).map(([name, value]) => [
      name,
      typeof value === "bigint" ? { type: "u64", value } : { type: "str", value },
    ]),
  ),
  payload: new Uint8Array(),
})

function chain(opts: { live?: Rec[]; hasReceipt?: boolean } = {}) {
  const byKey = new Map((opts.live ?? []).map((r) => [r.key, r]))
  const query = {
    where: () => query,
    createdBy: () => query,
    limit: () => query,
    fetch: async () => ({ entities: opts.hasReceipt ? [{ key: "0x1" }] : [] }),
  }
  return {
    getBlockTiming: async () => ({ currentBlock: BLOCK, currentBlockTime: 0, blockDuration: 2 }),
    getEntity: async (key: Hex) => {
      const r = byKey.get(key)
      if (!r) throw new NoEntityFoundError(key)
      return asEntity(r)
    },
    select: () => query,
  } as unknown as PublicClient
}

type Expiry = { minLifetime: bigint; expiresAt: bigint | Date }
type Batch = {
  creates?: {
    attributes: Record<string, { type: string; value: unknown }>
    expires: Expiry
    flags?: { readonly?: boolean }
  }[]
  extensions?: { entityKey: Hex; expires: Expiry }[]
  patches?: { entityKey: Hex; set?: Record<string, unknown> }[]
  deletes?: { entityKey: Hex }[]
}

function wallet() {
  const executeBatch = vi.fn(async (_batch: Batch) => ({ txHash: "0xtx" }))
  const createEntity = vi.fn(async (_data: unknown) => ({ entityKey: "0xnew", txHash: "0xtx", expiresAt: 5n }))
  const deleteEntity = vi.fn(async (_data: unknown) => ({ entityKey: "0xk", txHash: "0xtx" }))
  const client = { account: { address: CAMP }, executeBatch, createEntity, deleteEntity }
  return { client: client as unknown as WalletClient, executeBatch, createEntity, deleteEntity }
}

const sent = (w: ReturnType<typeof wallet>): Batch => {
  expect(w.executeBatch).toHaveBeenCalledTimes(1)
  return w.executeBatch.mock.calls[0]![0]
}

describe("postNeed", () => {
  const base = { site: siteRec(fresh(LIFETIME.site)), item: "clothes" as const, qty: 300, urgency: 3 as const }

  it("creates the need with the lifetime of its urgency, inheriting the site's place", async () => {
    const w = wallet()
    await postNeed(w.client, chain({ live: [base.site] }), base)
    const create = sent(w).creates![0]!
    expect(create.attributes.item).toEqual({ type: "str", value: "clothes" })
    expect(create.attributes.qty).toEqual({ type: "u64", value: 300n })
    expect(create.attributes.lat_e6).toEqual({ type: "u64", value: 27594000n })
    expect(create.attributes.site).toEqual({ type: "key", value: SITE_KEY })
    expect(create.expires.minLifetime).toBe(blocksFor(LIFETIME.need[3]))
  })

  it("gives a calmer need a longer lifetime", async () => {
    const w = wallet()
    await postNeed(w.client, chain({ live: [base.site] }), { ...base, urgency: 1 })
    expect(sent(w).creates![0]!.expires.minLifetime).toBe(blocksFor(LIFETIME.need[1]))
  })

  it("honours an explicit short lifetime for demos", async () => {
    const w = wallet()
    await postNeed(w.client, chain({ live: [base.site] }), { ...base, lifetimeSeconds: 180 })
    expect(sent(w).creates![0]!.expires.minLifetime).toBe(90n)
  })

  it("does not extend a site or org whose lease is still nearly full", async () => {
    const w = wallet()
    const live = [base.site, orgRec(fresh(LIFETIME.org))]
    await postNeed(w.client, chain({ live }), { ...base, orgKey: ORG_KEY })
    expect(sent(w).extensions).toEqual([])
  })

  it("renews the site and org leases in the same batch once they have aged", async () => {
    const w = wallet()
    const live = [siteRec(aged(LIFETIME.site)), orgRec(aged(LIFETIME.org))]
    await postNeed(w.client, chain({ live }), { ...base, orgKey: ORG_KEY })
    const ext = sent(w).extensions!
    expect(ext.map((e) => e.entityKey)).toEqual([SITE_KEY, ORG_KEY])
    expect(ext[0]!.expires).toMatchObject({ minLifetime: 0n, expiresAt: BLOCK + blocksFor(LIFETIME.site) })
    expect(ext[1]!.expires).toMatchObject({ minLifetime: 0n, expiresAt: BLOCK + blocksFor(LIFETIME.org) })
  })

  it("skips an org whose registration has lapsed instead of failing the post", async () => {
    const w = wallet()
    await postNeed(w.client, chain({ live: [base.site] }), { ...base, orgKey: ORG_KEY })
    expect(sent(w).extensions).toEqual([])
  })

  it("refuses to post against a camp listing that has expired", async () => {
    const w = wallet()
    await expect(postNeed(w.client, chain({ live: [] }), base)).rejects.toThrow(/camp listing has expired/)
    expect(w.executeBatch).not.toHaveBeenCalled()
  })

  it("rejects a phone number in the note before touching the network", async () => {
    const w = wallet()
    await expect(postNeed(w.client, chain(), { ...base, note: "call 98765 43210" })).rejects.toThrow(/phone/i)
    expect(w.executeBatch).not.toHaveBeenCalled()
  })

  it("rejects an invalid quantity", async () => {
    const w = wallet()
    await expect(postNeed(w.client, chain({ live: [base.site] }), { ...base, qty: 0 })).rejects.toThrow(RangeError)
    expect(w.executeBatch).not.toHaveBeenCalled()
  })
})

describe("reconfirmNeed", () => {
  it("lets the need run for a full lifetime from now", async () => {
    const w = wallet()
    const need = needRec(BLOCK + 100n)
    await reconfirmNeed(w.client, chain({ live: [need, siteRec(fresh(LIFETIME.site))] }), need)
    const [first] = sent(w).extensions!
    expect(first!.entityKey).toBe(NEED_KEY)
    expect(first!.expires).toMatchObject({ minLifetime: 0n, expiresAt: BLOCK + blocksFor(LIFETIME.need[3]) })
  })

  it("is strictly later than the expiry on chain, even if our snapshot was stale", async () => {
    const w = wallet()
    const onChain = needRec(BLOCK + blocksFor(LIFETIME.need[3]) + 500n)
    const stale = needRec(BLOCK + 10n)
    await reconfirmNeed(w.client, chain({ live: [onChain, siteRec(fresh(LIFETIME.site))] }), stale)
    expect(sent(w).extensions![0]!.expires.expiresAt).toBe(onChain.expiresAt + 1n)
  })

  it("keeps the camp listing alive in the same batch", async () => {
    const w = wallet()
    const need = needRec(BLOCK + 100n)
    await reconfirmNeed(w.client, chain({ live: [need, siteRec(aged(LIFETIME.site))] }), need)
    expect(sent(w).extensions!.map((e) => e.entityKey)).toEqual([NEED_KEY, SITE_KEY])
  })

  it("says so when the need has already expired", async () => {
    const w = wallet()
    const need = needRec(BLOCK + 100n)
    await expect(reconfirmNeed(w.client, chain({ live: [siteRec(fresh(LIFETIME.site))] }), need)).rejects.toThrow(
      /need has expired/,
    )
    expect(w.executeBatch).not.toHaveBeenCalled()
  })
})

describe("pledgeTo", () => {
  const now = () => Math.floor(Date.now() / 1000)
  const need = needRec(BLOCK + 5000n)

  it("creates a pledge that lapses two hours after its promised delivery", async () => {
    const w = wallet()
    const eta = now() + 3600
    await pledgeTo(w.client, chain(), { need, qty: 120, etaUnix: eta })
    const create = sent(w).creates![0]!
    expect(create.attributes.need).toEqual({ type: "key", value: NEED_KEY })
    expect(create.attributes.site).toEqual({ type: "key", value: SITE_KEY })
    expect(create.attributes.item).toEqual({ type: "str", value: "clothes" })
    expect(create.attributes.qty).toEqual({ type: "u64", value: 120n })
    expect(create.attributes.eta).toEqual({ type: "u64", value: BigInt(eta) })
    expect((create.expires.expiresAt as Date).getTime()).toBe((eta + LIFETIME.pledgeGrace) * 1000)
  })

  it("renews the donor org lease in the same batch when it has aged", async () => {
    const w = wallet()
    await pledgeTo(w.client, chain({ live: [orgRec(aged(LIFETIME.org))] }), {
      need,
      qty: 10,
      etaUnix: now() + 3600,
      orgKey: ORG_KEY,
    })
    expect(sent(w).extensions!.map((e) => e.entityKey)).toEqual([ORG_KEY])
  })

  it("rejects a delivery time in the past or beyond 48 hours", async () => {
    const w = wallet()
    await expect(pledgeTo(w.client, chain(), { need, qty: 1, etaUnix: now() - 5 })).rejects.toThrow(RangeError)
    await expect(pledgeTo(w.client, chain(), { need, qty: 1, etaUnix: now() + 49 * 3600 })).rejects.toThrow(
      /within 48 hours/,
    )
    expect(w.executeBatch).not.toHaveBeenCalled()
  })

  it("rejects a phone number in the note", async () => {
    const w = wallet()
    await expect(
      pledgeTo(w.client, chain(), { need, qty: 1, etaUnix: now() + 3600, note: "+91 98765 43210" }),
    ).rejects.toThrow(/phone/i)
    expect(w.executeBatch).not.toHaveBeenCalled()
  })
})

describe("recordReceipt", () => {
  const pledge = (qty: bigint) => pledgeRec(qty)

  it("records a partial delivery and lowers the need in one atomic batch", async () => {
    const w = wallet()
    const need = needRec(BLOCK + 5000n)
    await recordReceipt(w.client, chain({ live: [need] }), { pledge: pledge(120n), need })
    const batch = sent(w)
    const receipt = batch.creates![0]!
    expect(receipt.attributes.pledge).toEqual({ type: "key", value: PLEDGE_KEY })
    expect(receipt.attributes.qty).toEqual({ type: "u64", value: 120n })
    expect(receipt.attributes.pledger).toMatchObject({ type: "addr" })
    expect(receipt.flags).toEqual({ readonly: true })
    expect(receipt.expires.minLifetime).toBe(blocksFor(LIFETIME.receipt))
    expect(batch.patches).toEqual([{ entityKey: NEED_KEY, set: { qty: { type: "u64", value: 180n } } }])
    expect(batch.deletes).toBeUndefined()
  })

  it("deletes the need when the delivery covers it completely", async () => {
    const w = wallet()
    const need = needRec(BLOCK + 5000n)
    await recordReceipt(w.client, chain({ live: [need] }), { pledge: pledge(300n), need })
    const batch = sent(w)
    expect(batch.deletes).toEqual([{ entityKey: NEED_KEY }])
    expect(batch.patches).toBeUndefined()
  })

  it("subtracts from the quantity on chain rather than from a stale snapshot", async () => {
    const w = wallet()
    const stale = needRec(BLOCK + 5000n, 300n)
    const onChain = needRec(BLOCK + 5000n, 200n)
    await recordReceipt(w.client, chain({ live: [onChain] }), { pledge: pledge(120n), need: stale })
    expect(sent(w).patches![0]!.set).toEqual({ qty: { type: "u64", value: 80n } })
  })

  it("still records the receipt when the need has already expired", async () => {
    const w = wallet()
    const need = needRec(BLOCK + 5000n)
    await recordReceipt(w.client, chain({ live: [] }), { pledge: pledge(120n), need })
    const batch = sent(w)
    expect(batch.creates).toHaveLength(1)
    expect(batch.patches).toBeUndefined()
    expect(batch.deletes).toBeUndefined()
  })

  it("refuses to record the same delivery twice", async () => {
    const w = wallet()
    const need = needRec(BLOCK + 5000n)
    await expect(
      recordReceipt(w.client, chain({ live: [need], hasReceipt: true }), { pledge: pledge(120n), need }),
    ).rejects.toThrow(/already recorded/)
    expect(w.executeBatch).not.toHaveBeenCalled()
  })
})

describe("single-entity writes", () => {
  it("registers an org with a long lease and a public helpline", async () => {
    const w = wallet()
    await registerOrg(w.client, { name: "Dhemaji DDMA (demo)", helpline: "1077", orgType: "govt", state: "AS", district: "Dhemaji" })
    const data = w.createEntity.mock.calls[0]![0] as Batch["creates"] extends (infer U)[] | undefined ? U : never
    expect(data.attributes.org_type).toEqual({ type: "str", value: "govt" })
    expect(data.expires.minLifetime).toBe(blocksFor(LIFETIME.org))
  })

  it("keeps mobile numbers out of org and site free text", async () => {
    const w = wallet()
    await expect(
      registerOrg(w.client, { name: "Camp", helpline: "98765 43210", orgType: "ngo", state: "AS", district: "d" }),
    ).rejects.toThrow(/phone/i)
    await expect(
      createSite(w.client, {
        name: "Camp",
        landmark: "near school, call 9876543210",
        siteType: "camp",
        state: "AS",
        district: "d",
        lat: 27.5,
        lng: 94.5,
        people: 10,
      }),
    ).rejects.toThrow(/phone/i)
    expect(w.createEntity).not.toHaveBeenCalled()
  })

  it("creates a camp listing that lives a week unless the camp keeps confirming", async () => {
    const w = wallet()
    await createSite(w.client, { name: "Silapathar camp (demo)", siteType: "camp", state: "AS", district: "Dhemaji", lat: 27.594, lng: 94.723, people: 400 })
    const data = w.createEntity.mock.calls[0]![0] as NonNullable<Batch["creates"]>[number]
    expect(data.attributes.people).toEqual({ type: "u64", value: 400n })
    expect(data.expires.minLifetime).toBe(blocksFor(LIFETIME.site))
  })

  it("writes a vouch as a read-only entity that lapses in 30 days", async () => {
    const w = wallet()
    await vouchFor(w.client, { org: DONOR, district: "Dhemaji" })
    const data = w.createEntity.mock.calls[0]![0] as NonNullable<Batch["creates"]>[number]
    expect(data.flags).toEqual({ readonly: true })
    expect(data.expires.minLifetime).toBe(blocksFor(LIFETIME.vouch))
    expect(data.attributes.district).toEqual({ type: "str", value: "dhemaji" })
  })

  it("cancels a pledge by deleting it", async () => {
    const w = wallet()
    await cancelPledge(w.client, PLEDGE_KEY)
    expect(w.deleteEntity).toHaveBeenCalledWith({ entityKey: PLEDGE_KEY })
  })
})
