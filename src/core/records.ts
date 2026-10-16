import type { Address, Hex } from "viem"

export type AttrValue = string | bigint

export type Rec = {
  key: Hex
  creator: Address
  owner: Address
  expiresAt: bigint
  attrs: Record<string, AttrValue>
  payload: Readonly<Partial<Record<string, string>>>
}

type EntityLike = {
  key?: Hex | undefined
  creator?: Hex | undefined
  owner?: Hex | undefined
  expiresAt?: bigint | undefined
  attributes?: Readonly<Record<string, { type: string; value: unknown }>> | undefined
  payload?: Uint8Array | undefined
}

// C0 and C1 control characters, ESC included. Printed to a terminal, a stranger's text could move the cursor and
// overwrite what the command line shows about other camps; on a page they are invisible at best.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
// A surrogate pair, or a lone surrogate: JSON can carry one ("\ud800"), and encodeURIComponent throws on it. Pairs are
// kept, lone halves become U+FFFD. (No lookbehind, which older Safari cannot even parse.)
const SURROGATE = /[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g
const clean = (text: string) => text.replace(CONTROL, " ").replace(SURROGATE, (unit) => (unit.length === 2 ? unit : "\ufffd"))

// Strings, keys and addresses are lowercased so equality checks never depend on hex casing.
export function toRec(e: EntityLike): Rec {
  if (!e.key || !e.creator || !e.owner || e.expiresAt === undefined) {
    throw new Error("entity is missing key/creator/owner/expiresAt: select them in the query")
  }
  const attrs: Record<string, AttrValue> = {}
  for (const [name, v] of Object.entries(e.attributes ?? {})) {
    attrs[name] = typeof v.value === "bigint" ? v.value : clean(String(v.value).toLowerCase())
  }
  // Anyone can write any payload. Only the string fields of a JSON object are kept, so a reader can always print
  // `payload.name` (String() throws on an object such as {"toString": 1}).
  const payload: Record<string, string> = {}
  if (e.payload && e.payload.length > 0) {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(e.payload))
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [field, value] of Object.entries(parsed)) if (typeof value === "string") payload[field] = clean(value)
      }
    } catch {
      // Not JSON: nothing to keep.
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
