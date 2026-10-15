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

// Strings, keys and addresses are lowercased so equality checks never depend on hex casing.
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
