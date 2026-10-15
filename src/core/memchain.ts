// An in-memory stand-in for an Arkiv node. It exists so the app's flows can be integration-tested, including
// six-hour Entity Expirations, and so the UI can run offline in development. It models what was verified
// against Tiramisu: owner checks, read-only entities, strictly non-shortening Lifetime Extension, atomic
// batches applied as creates -> patches -> deletes -> extensions, uppercase attribute names rejected, and
// cursors that only work at the block they were issued for (page.next() fails once the head has moved).
import {
  type ArkivValue,
  type CreateEntityParameters,
  Entity,
  type EntityEvent,
  EntityMutationError,
  type ExecuteBatchParameters,
  type Expression,
  NoEntityFoundError,
  resolveExpiry,
  toValue,
  validateAttributeName,
} from "@arkiv-network/sdk"
import { addr, key, u64 } from "@arkiv-network/sdk/attr"
import { and, eq } from "@arkiv-network/sdk/query"
import { type Address, type Hex, keccak256, stringToHex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import type { PublicClient, WalletClient } from "./arkiv"

type Stored = {
  key: Hex
  owner: Address
  creator: Address
  createdAt: bigint
  updatedAt: bigint
  expiresAt: bigint
  attributes: Record<string, ArkivValue>
  payload: Uint8Array
  contentType: string
  readonly: boolean
  permissionlessExtension: boolean
}

export type MemChainOptions = {
  startBlock?: bigint
  // Follow the wall clock (one block per 2 s) instead of only advancing when advance() is called.
  auto?: boolean
}

const PAGE_MAX = 200
const PAGE_DEFAULT = 100

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type EventBody = DistributiveOmit<EntityEvent, "blockNumber" | "transactionHash" | "logIndex">

class Revert extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

const revert = (reason: string, entityKey?: Hex) => new Revert(entityKey ? `${reason}(${entityKey})` : reason)

type Operator = "=" | "!=" | "<" | "<=" | ">" | ">="

const comparable = (v: ArkivValue): string | bigint | number | boolean =>
  v.type === "key" || v.type === "addr" ? String(v.value).toLowerCase() : v.value

function compare(actual: ArkivValue | undefined, operator: Operator, wanted: ArkivValue): boolean {
  // A typed comparison: an attribute of another type, or one that was never set, never matches.
  if (!actual || actual.type !== wanted.type) return false
  const a = comparable(actual) as never
  const b = comparable(wanted) as never
  switch (operator) {
    case "=": return a === b
    case "!=": return a !== b
    case "<": return a < b
    case "<=": return a <= b
    case ">": return a > b
    case ">=": return a >= b
  }
}

function attributeOf(e: Stored, name: string): ArkivValue | undefined {
  switch (name) {
    case "$key": return key(e.key)
    case "$owner": return addr(e.owner)
    case "$creator": return addr(e.creator)
    case "$expiresAt": return u64(e.expiresAt)
    default: return e.attributes[name]
  }
}

function matches(e: Stored, expression: Expression): boolean {
  switch (expression.kind) {
    case "comparison": return compare(attributeOf(e, expression.name), expression.operator, expression.value)
    case "startsWith": {
      const actual = attributeOf(e, expression.name)
      return actual?.type === "str" && actual.value.startsWith(expression.value.value)
    }
    case "exists": return attributeOf(e, expression.name) !== undefined
    case "typeOf": return attributeOf(e, expression.name)?.type === expression.tag
    case "not": return !matches(e, expression.expression)
    case "and": return expression.expressions.every((x) => matches(e, x))
    case "or": return expression.expressions.some((x) => matches(e, x))
  }
}

const FIELDS = ["key", "owner", "creator", "createdAt", "updatedAt", "expiresAt", "creationFlags", "contentType", "payload", "attributeSchema", "attributes"] as const

type Selection = "*" | undefined | Partial<Record<(typeof FIELDS)[number], boolean | Record<string, boolean>>>

function project(e: Stored, selection: Selection): Entity {
  const all = selection === undefined || selection === "*"
  const wants = (field: (typeof FIELDS)[number]) => all || !!selection[field]
  const fields: ConstructorParameters<typeof Entity>[0] = {}
  if (wants("key")) fields.key = e.key
  if (wants("owner")) fields.owner = e.owner
  if (wants("creator")) fields.creator = e.creator
  if (wants("createdAt")) fields.createdAt = e.createdAt
  if (wants("updatedAt")) fields.updatedAt = e.updatedAt
  if (wants("expiresAt")) fields.expiresAt = e.expiresAt
  if (wants("creationFlags")) {
    fields.creationFlags = {
      readonly: e.readonly,
      permissionlessExtension: e.permissionlessExtension,
      raw: (e.readonly ? 1 : 0) | (e.permissionlessExtension ? 2 : 0),
    }
  }
  if (wants("contentType")) fields.contentType = e.contentType
  if (wants("payload")) fields.payload = e.payload
  if (wants("attributeSchema")) {
    fields.attributeSchema = Object.fromEntries(Object.entries(e.attributes).map(([name, v]) => [name, v.type]))
  }
  if (wants("attributes")) {
    const picked = all ? undefined : selection.attributes
    fields.attributes =
      picked && typeof picked === "object"
        ? Object.fromEntries(Object.entries(e.attributes).filter(([name]) => picked[name]))
        : { ...e.attributes }
  }
  return new Entity(fields)
}

class MemQueryError extends Error {
  readonly kind = "cursor"
  constructor(readonly code: number, readonly data: { message: string }) {
    super(`Query rejected (cursor, ${code}): Request exceeds defined limit.`)
  }
}

export function createMemChain(options: MemChainOptions = {}) {
  const start = options.startBlock ?? 600_000n
  const startedAt = Date.now()
  const baseUnix = Math.floor(startedAt / 1000)
  let manual = 0n
  let counter = 0
  const store = new Map<Hex, Stored>()
  const listeners = new Set<(e: EntityEvent) => void>()

  const block = (): bigint => start + manual + (options.auto ? BigInt(Math.floor((Date.now() - startedAt) / 2000)) : 0n)
  const isLive = (e: Stored, at: bigint) => e.createdAt <= at && e.expiresAt > at
  const nextTx = () => keccak256(stringToHex(`tx:${counter++}`))

  function execute(sender: Address, batch: ExecuteBatchParameters) {
    const { creates = [], patches = [], deletes = [], extensions = [], ownershipChanges = [] } = batch
    if (creates.length + patches.length + deletes.length + extensions.length + ownershipChanges.length === 0) {
      throw new EntityMutationError("No operations to perform")
    }
    const head = block()
    const working = new Map(store)
    const txHash = nextTx()
    const events: EventBody[] = []
    const created: Hex[] = []

    const liveEntity = (entityKey: Hex): Stored => {
      const found = working.get(entityKey)
      if (!found || found.expiresAt <= head) throw revert("EntityNotFound", entityKey)
      return found
    }
    const ownedBySender = (e: Stored) => {
      if (e.owner.toLowerCase() !== sender.toLowerCase()) throw revert("NotOwner", e.key)
    }

    try {
      for (const item of creates) {
        const attributes: Record<string, ArkivValue> = {}
        for (const [name, input] of Object.entries(item.attributes ?? {})) {
          validateAttributeName(name)
          if (/[A-Z]/.test(name)) throw revert("Ident32InvalidByte")
          attributes[name] = toValue(input, name)
        }
        const { target } = resolveExpiry(item.expires, { currentBlock: head })
        const entityKey = keccak256(stringToHex(`${sender}:${counter++}`))
        working.set(entityKey, {
          key: entityKey,
          owner: sender,
          creator: sender,
          createdAt: head,
          updatedAt: head,
          expiresAt: target,
          attributes,
          payload: item.payload,
          contentType: item.contentType,
          readonly: !!item.flags?.readonly,
          permissionlessExtension: !!item.flags?.permissionlessExtension,
        })
        created.push(entityKey)
        events.push({
          type: "EntityCreated",
          entityKey,
          owner: sender,
          expiresAt: target,
          creationFlags: {
            readonly: !!item.flags?.readonly,
            permissionlessExtension: !!item.flags?.permissionlessExtension,
            raw: (item.flags?.readonly ? 1 : 0) | (item.flags?.permissionlessExtension ? 2 : 0),
          },
        })
      }

      for (const item of patches) {
        const e = liveEntity(item.entityKey)
        ownedBySender(e)
        if (e.readonly) throw revert("ReadOnlyEntity", e.key)
        const attributes = { ...e.attributes }
        for (const [name, input] of Object.entries(item.set ?? {})) {
          validateAttributeName(name)
          if (/[A-Z]/.test(name)) throw revert("Ident32InvalidByte")
          attributes[name] = toValue(input, name)
        }
        for (const name of item.unset ?? []) delete attributes[name]
        working.set(e.key, {
          ...e,
          attributes,
          payload: item.payload ?? e.payload,
          contentType: item.contentType ?? e.contentType,
          updatedAt: head,
        })
        events.push({ type: "EntityPatched", entityKey: e.key, owner: e.owner })
      }

      for (const item of deletes) {
        const e = liveEntity(item.entityKey)
        ownedBySender(e)
        working.delete(e.key)
        events.push({ type: "EntityDeleted", entityKey: e.key, owner: e.owner })
      }

      for (const item of extensions) {
        const e = liveEntity(item.entityKey)
        if (!e.permissionlessExtension) ownedBySender(e)
        const { target } = resolveExpiry(item.expires, { currentBlock: head })
        if (target < e.expiresAt) throw revert("ExpiryNotExtended", e.key)
        working.set(e.key, { ...e, expiresAt: target, updatedAt: head })
        events.push({ type: "ExpiryExtended", entityKey: e.key, owner: e.owner, expiresAt: target })
      }

      // A one-sided hand-over: the new owner is never asked. This is why readers trust $creator, not $owner.
      for (const item of ownershipChanges) {
        const e = liveEntity(item.entityKey)
        ownedBySender(e)
        working.set(e.key, { ...e, owner: item.newOwner, updatedAt: head })
        events.push({ type: "OwnershipTransferred", entityKey: e.key, previousOwner: e.owner, newOwner: item.newOwner })
      }
    } catch (error) {
      if (error instanceof Revert) {
        throw new EntityMutationError(`Transaction reverted. Reason: ${error.reason}`, { cause: error, txHash })
      }
      throw error
    }

    store.clear()
    for (const [k, v] of working) store.set(k, v)
    events.forEach((partial, logIndex) => {
      const event = { ...partial, blockNumber: head, transactionHash: txHash, logIndex } as EntityEvent
      for (const listener of listeners) listener(event)
    })
    return { txHash, created, expiries: events }
  }

  function select(selection?: Selection) {
    const filters: Expression[] = []
    let limit: number | undefined
    let atBlock: bigint | undefined
    let cursor: string | undefined

    const builder = {
      where: (...expressions: Array<Expression | readonly Expression[]>) => {
        filters.push(...expressions.flat())
        return builder
      },
      ownedBy: (owner: Hex) => {
        filters.push(eq("$owner", addr(owner)))
        return builder
      },
      createdBy: (creator: Hex) => {
        filters.push(eq("$creator", addr(creator)))
        return builder
      },
      limit: (n: number) => {
        limit = n
        return builder
      },
      atBlock: (b: bigint) => {
        atBlock = b
        return builder
      },
      cursor: (c: string) => {
        cursor = c
        return builder
      },
      fetch: () => {
        if (filters.length === 0) throw new Error("A query needs at least one filter")
        return page({ query: and([...filters]).toString(), filters: [...filters], selection, limit, atBlock }, cursor)
      },
    }
    return builder
  }

  type Request = { query: string; filters: Expression[]; selection: Selection; limit: number | undefined; atBlock: bigint | undefined }

  async function page(request: Request, cursor: string | undefined): Promise<unknown> {
    if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1)) {
      throw new Error(`limit must be a positive integer, got ${request.limit}.`)
    }
    if (request.limit !== undefined && request.limit > PAGE_MAX) {
      throw new Error(`limit ${request.limit} exceeds the node maximum of ${PAGE_MAX}. Page through the results with the cursor instead.`)
    }
    const readAt = request.atBlock ?? block()
    const tag = keccak256(stringToHex(request.query)).slice(2, 10)
    let offset = 0
    if (cursor !== undefined) {
      const [cursorBlock, cursorOffset, cursorTag] = cursor.split(":")
      if (BigInt(cursorBlock ?? "-1") !== readAt || cursorTag !== tag) {
        throw new MemQueryError(-32005, { message: "cursor belongs to a different query, block or select — start a new page-through" })
      }
      offset = Number(cursorOffset)
    }
    const matching = [...store.values()]
      .filter((e) => isLive(e, readAt) && request.filters.every((f) => matches(e, f)))
      .sort((a, b) => (a.createdAt === b.createdAt ? (a.key < b.key ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1))
    const size = request.limit ?? PAGE_DEFAULT
    const entities = matching.slice(offset, offset + size).map((e) => project(e, request.selection))
    const nextCursor = offset + size < matching.length ? `${readAt}:${offset + size}:${tag}` : undefined
    const result = {
      entities,
      blockNumber: readAt,
      cursor: nextCursor,
      hasNextPage: () => nextCursor !== undefined,
      next: () => page(request, nextCursor),
    }
    return result
  }

  const watchEntityEvents = (handlers: {
    onEvent?: (e: EntityEvent) => void
    onEntityCreated?: (e: EntityEvent) => void
    onEntityPatched?: (e: EntityEvent) => void
    onExpiryExtended?: (e: EntityEvent) => void
    onEntityDeleted?: (e: EntityEvent) => void
  }) => {
    const listener = (event: EntityEvent) => {
      handlers.onEvent?.(event)
      const specific = {
        EntityCreated: handlers.onEntityCreated,
        EntityPatched: handlers.onEntityPatched,
        ExpiryExtended: handlers.onExpiryExtended,
        EntityDeleted: handlers.onEntityDeleted,
        OwnershipTransferred: undefined,
      }[event.type]
      specific?.(event)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const pub = {
    getBlockNumber: async () => block(),
    getBlockTiming: async () => ({ currentBlock: block(), currentBlockTime: baseUnix + Number(block() - start) * 2, blockDuration: 2 }),
    getEntityCount: async () => [...store.values()].filter((e) => isLive(e, block())).length,
    getBalance: async () => 10n ** 21n,
    getEntity: async (entityKey: Hex) => {
      const found = store.get(entityKey)
      if (!found || !isLive(found, block())) throw new NoEntityFoundError(entityKey)
      return project(found, "*")
    },
    select,
    watchEntityEvents,
  } as unknown as PublicClient

  function wallet(privateKey: Hex = generatePrivateKey()) {
    const account = privateKeyToAccount(privateKey)
    const executeBatch = async (data: ExecuteBatchParameters) => {
      const { txHash, created } = execute(account.address, data)
      return {
        txHash,
        createdEntities: created,
        patchedEntities: (data.patches ?? []).map((p) => p.entityKey),
        deletedEntities: (data.deletes ?? []).map((d) => d.entityKey),
        extendedEntities: (data.extensions ?? []).map((x) => x.entityKey),
        ownershipChanges: (data.ownershipChanges ?? []).map((o) => o.entityKey),
      }
    }
    const client = {
      account,
      executeBatch,
      createEntity: async (data: CreateEntityParameters) => {
        const { txHash, created } = execute(account.address, { creates: [data] })
        const entityKey = created[0] as Hex
        return { entityKey, txHash, expiresAt: (store.get(entityKey) as Stored).expiresAt }
      },
      patchEntity: async (data: NonNullable<ExecuteBatchParameters["patches"]>[number]) => ({
        entityKey: data.entityKey,
        txHash: execute(account.address, { patches: [data] }).txHash,
      }),
      deleteEntity: async (data: { entityKey: Hex }) => ({
        entityKey: data.entityKey,
        txHash: execute(account.address, { deletes: [data] }).txHash,
      }),
      extendEntity: async (data: NonNullable<ExecuteBatchParameters["extensions"]>[number]) => {
        const { txHash } = execute(account.address, { extensions: [data] })
        return { entityKey: data.entityKey, txHash, expiresAt: (store.get(data.entityKey) as Stored).expiresAt }
      },
      changeOwnership: async (data: NonNullable<ExecuteBatchParameters["ownershipChanges"]>[number]) => ({
        entityKey: data.entityKey,
        txHash: execute(account.address, { ownershipChanges: [data] }).txHash,
      }),
      getBalance: async () => 10n ** 21n,
    }
    return client as unknown as WalletClient
  }

  return {
    pub,
    wallet,
    block,
    advance: (blocks: bigint) => {
      manual += blocks
    },
    // Wall-clock seconds that correspond to the chain's current block.
    unixNow: () => baseUnix + Number(block() - start) * 2,
    entityCount: () => store.size,
  }
}

export type MemChain = ReturnType<typeof createMemChain>
