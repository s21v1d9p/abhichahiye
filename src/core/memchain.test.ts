import { EntityMutationError, ExpirationTime, NoEntityFoundError } from "@arkiv-network/sdk"
import { addr, key, str, u64 } from "@arkiv-network/sdk/attr"
import { eq, gte, lte, not } from "@arkiv-network/sdk/query"
import { jsonToPayload } from "@arkiv-network/sdk/utils"
import { describe, expect, it } from "vitest"
import type { Hex } from "viem"
import { createMemChain } from "./memchain"

const json = (o: object) => ({ payload: jsonToPayload(o), contentType: "application/json" as const })

describe("memchain entities", () => {
  it("creates, reads back and expires an entity", async () => {
    const chain = createMemChain()
    const alice = chain.wallet()
    const { entityKey, expiresAt } = await alice.createEntity({
      ...json({ hello: "world" }),
      attributes: { app: str("t"), n: u64(5n) },
      expires: ExpirationTime.fromSeconds(60),
    })
    const entity = await chain.pub.getEntity(entityKey)
    expect(entity.creator).toBe(alice.account.address)
    expect(entity.owner).toBe(alice.account.address)
    expect(entity.toJson()).toEqual({ hello: "world" })
    expect(entity.attributes.n).toEqual({ type: "u64", value: 5n })
    expect(expiresAt).toBe(chain.block() + 30n)

    chain.advance(29n)
    await expect(chain.pub.getEntity(entityKey)).resolves.toBeTruthy()
    chain.advance(1n)
    await expect(chain.pub.getEntity(entityKey)).rejects.toBeInstanceOf(NoEntityFoundError)
  })

  it("rejects uppercase attribute names, as the node does", async () => {
    const alice = createMemChain().wallet()
    await expect(
      alice.createEntity({ ...json({}), attributes: { Foo: str("x") }, expires: ExpirationTime.fromSeconds(60) }),
    ).rejects.toThrow(/Ident32InvalidByte/)
  })
})

describe("memchain Lifetime Extension", () => {
  const setup = async () => {
    const chain = createMemChain()
    const owner = chain.wallet()
    const { entityKey, expiresAt } = await owner.createEntity({ ...json({}), expires: ExpirationTime.fromSeconds(600) })
    return { chain, owner, entityKey, expiresAt }
  }

  it("lets the owner extend to a later block and accepts the same block", async () => {
    const { owner, entityKey, expiresAt } = await setup()
    await expect(owner.extendEntity({ entityKey, expires: ExpirationTime.atBlock(expiresAt + 1n) })).resolves.toBeTruthy()
    await expect(owner.extendEntity({ entityKey, expires: ExpirationTime.atBlock(expiresAt + 1n) })).resolves.toBeTruthy()
  })

  it("rejects an extension that would shorten the entity's life", async () => {
    const { owner, entityKey, expiresAt } = await setup()
    await expect(owner.extendEntity({ entityKey, expires: ExpirationTime.atBlock(expiresAt - 1n) })).rejects.toThrow(
      /ExpiryNotExtended/,
    )
  })

  it("rejects an extension by someone who is not the owner", async () => {
    const { chain, entityKey, expiresAt } = await setup()
    const mallory = chain.wallet()
    await expect(mallory.extendEntity({ entityKey, expires: ExpirationTime.atBlock(expiresAt + 10n) })).rejects.toThrow(
      /NotOwner/,
    )
  })

  it("rejects an extension of an entity that is gone", async () => {
    const { chain, owner, entityKey, expiresAt } = await setup()
    chain.advance(expiresAt - chain.block())
    await expect(owner.extendEntity({ entityKey, expires: ExpirationTime.atBlock(expiresAt + 10n) })).rejects.toThrow(
      /EntityNotFound/,
    )
  })
})

describe("memchain batches", () => {
  it("applies creates, patches, deletes and extensions atomically", async () => {
    const chain = createMemChain()
    const w = chain.wallet()
    const a = await w.createEntity({ ...json({}), attributes: { qty: u64(10n) }, expires: ExpirationTime.fromSeconds(600) })
    const b = await w.createEntity({ ...json({}), expires: ExpirationTime.fromSeconds(600) })

    const result = await w.executeBatch({
      creates: [{ ...json({}), attributes: { kind: str("new") }, expires: ExpirationTime.fromSeconds(60) }],
      patches: [{ entityKey: a.entityKey, set: { qty: u64(4n) } }],
      deletes: [{ entityKey: b.entityKey }],
      extensions: [{ entityKey: a.entityKey, expires: ExpirationTime.atBlock(a.expiresAt + 100n) }],
    })
    expect(result.createdEntities).toHaveLength(1)
    const patched = await chain.pub.getEntity(a.entityKey)
    expect(patched.attributes.qty).toEqual({ type: "u64", value: 4n })
    expect(patched.expiresAt).toBe(a.expiresAt + 100n)
    await expect(chain.pub.getEntity(b.entityKey)).rejects.toBeInstanceOf(NoEntityFoundError)
  })

  it("rolls everything back when one operation fails", async () => {
    const chain = createMemChain()
    const w = chain.wallet()
    const before = chain.entityCount()
    await expect(
      w.executeBatch({
        creates: [{ ...json({}), expires: ExpirationTime.fromSeconds(60) }],
        deletes: [{ entityKey: `0x${"7".repeat(64)}` as Hex }],
      }),
    ).rejects.toBeInstanceOf(EntityMutationError)
    expect(chain.entityCount()).toBe(before)
  })

  it("makes read-only entities immutable but still extendable and deletable", async () => {
    const chain = createMemChain()
    const w = chain.wallet()
    const { entityKey, expiresAt } = await w.createEntity({
      ...json({}),
      attributes: { n: u64(1n) },
      expires: ExpirationTime.fromSeconds(600),
      flags: { readonly: true },
    })
    await expect(w.patchEntity({ entityKey, set: { n: u64(2n) } })).rejects.toThrow(/ReadOnlyEntity/)
    await expect(w.extendEntity({ entityKey, expires: ExpirationTime.atBlock(expiresAt + 5n) })).resolves.toBeTruthy()
    await expect(w.deleteEntity({ entityKey })).resolves.toBeTruthy()
  })

  it("lets anyone extend a permissionlessExtension entity, and nobody else touch it", async () => {
    const chain = createMemChain()
    const w = chain.wallet()
    const stranger = chain.wallet()
    const { entityKey, expiresAt } = await w.createEntity({
      ...json({}),
      expires: ExpirationTime.fromSeconds(600),
      flags: { permissionlessExtension: true },
    })
    await expect(stranger.extendEntity({ entityKey, expires: ExpirationTime.atBlock(expiresAt + 5n) })).resolves.toBeTruthy()
    await expect(stranger.deleteEntity({ entityKey })).rejects.toThrow(/NotOwner/)
  })
})

describe("memchain queries", () => {
  const populate = async () => {
    const chain = createMemChain()
    const a = chain.wallet()
    const b = chain.wallet()
    for (const [w, n] of [[a, 1n], [a, 5n], [b, 9n]] as const) {
      await w.createEntity({ ...json({}), attributes: { app: str("t"), n: u64(n) }, expires: ExpirationTime.fromSeconds(600) })
    }
    return { chain, a, b }
  }

  it("filters by typed equality and numeric ranges", async () => {
    const { chain } = await populate()
    const between = await chain.pub.select({ key: true }).where(eq("app", "t"), gte("n", u64(2n)), lte("n", u64(9n))).fetch()
    expect(between.entities).toHaveLength(2)
    expect((await chain.pub.select({ key: true }).where(eq("n", u64(5n))).fetch()).entities).toHaveLength(1)
    expect((await chain.pub.select({ key: true }).where(not(eq("n", u64(5n)))).fetch()).entities).toHaveLength(2)
  })

  it("filters by creator and owner", async () => {
    const { chain, a } = await populate()
    const mine = await chain.pub.select({ key: true }).where(eq("app", "t")).createdBy(a.account.address).fetch()
    expect(mine.entities).toHaveLength(2)
    const owned = await chain.pub.select({ key: true }).where(eq("app", "t")).ownedBy(a.account.address).fetch()
    expect(owned.entities).toHaveLength(2)
  })

  it("matches keys and addresses regardless of hex casing", async () => {
    const chain = createMemChain()
    const w = chain.wallet()
    const first = await w.createEntity({ ...json({}), expires: ExpirationTime.fromSeconds(600) })
    await w.createEntity({
      ...json({}),
      attributes: { ref: key(first.entityKey), who: addr(w.account.address) },
      expires: ExpirationTime.fromSeconds(600),
    })
    const hit = await chain.pub.select({ key: true }).where(eq("ref", key(first.entityKey)), eq("who", addr(w.account.address))).fetch()
    expect(hit.entities).toHaveLength(1)
  })

  it("only returns live entities and honours $expiresAt", async () => {
    const { chain } = await populate()
    chain.advance(299n)
    expect((await chain.pub.select({ key: true }).where(eq("app", "t")).fetch()).entities).toHaveLength(3)
    chain.advance(1n)
    expect((await chain.pub.select({ key: true }).where(eq("app", "t")).fetch()).entities).toHaveLength(0)
  })

  it("projects only the selected fields", async () => {
    const { chain } = await populate()
    const [only] = (await chain.pub.select({ key: true }).where(eq("app", "t")).fetch()).entities
    expect(only?.key).toBeDefined()
    expect((only as { attributes?: unknown } | undefined)?.attributes).toBeUndefined()
  })

  it("rejects a page size above the node maximum", async () => {
    const { chain } = await populate()
    await expect(chain.pub.select({ key: true }).where(eq("app", "t")).limit(201).fetch()).rejects.toThrow(/exceeds the node maximum/)
  })
})

describe("memchain cursor pagination", () => {
  const big = async () => {
    const chain = createMemChain()
    const w = chain.wallet()
    for (let i = 0; i < 5; i++) {
      await w.createEntity({ ...json({}), attributes: { app: str("t"), i: u64(BigInt(i)) }, expires: ExpirationTime.fromSeconds(6000) })
    }
    return chain
  }

  it("walks every page when the walk is pinned to one block", async () => {
    const chain = await big()
    const head = chain.block()
    let page = await chain.pub.select({ key: true }).where(eq("app", "t")).limit(2).atBlock(head).fetch()
    const seen = new Set(page.entities.map((e) => e.key))
    while (page.hasNextPage()) {
      chain.advance(3n)
      page = await page.next()
      for (const e of page.entities) seen.add(e.key)
    }
    expect(seen.size).toBe(5)
  })

  it("rejects page.next() once the head has moved, like the node (-32005)", async () => {
    const chain = await big()
    const first = await chain.pub.select({ key: true }).where(eq("app", "t")).limit(2).fetch()
    chain.advance(1n)
    await expect(first.next()).rejects.toMatchObject({ code: -32005 })
  })

  it("accepts page.next() while the head has not moved", async () => {
    const chain = await big()
    const first = await chain.pub.select({ key: true }).where(eq("app", "t")).limit(2).fetch()
    await expect(first.next()).resolves.toBeTruthy()
  })
})

describe("memchain events", () => {
  it("emits an event for every applied operation, in order", async () => {
    const chain = createMemChain()
    const w = chain.wallet()
    const seen: string[] = []
    const stop = chain.pub.watchEntityEvents({ onEvent: (e) => seen.push(e.type) })
    const a = await w.createEntity({ ...json({}), attributes: { n: u64(1n) }, expires: ExpirationTime.fromSeconds(600) })
    await w.patchEntity({ entityKey: a.entityKey, set: { n: u64(2n) } })
    await w.extendEntity({ entityKey: a.entityKey, expires: ExpirationTime.atBlock(a.expiresAt + 10n) })
    await w.deleteEntity({ entityKey: a.entityKey })
    stop()
    await w.createEntity({ ...json({}), expires: ExpirationTime.fromSeconds(600) })
    expect(seen).toEqual(["EntityCreated", "EntityPatched", "ExpiryExtended", "EntityDeleted"])
  })
})
