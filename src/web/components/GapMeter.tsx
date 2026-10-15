const SEGMENTS = 24

// Segments filled in green are promised; the hatched rest is still short.
export function GapMeter({ qty, pledged }: { qty: bigint; pledged: bigint }) {
  const share = qty === 0n ? 0 : Number((pledged * BigInt(SEGMENTS)) / qty)
  const filled = pledged > 0n ? Math.min(SEGMENTS, Math.max(1, share)) : 0
  return (
    <div className="meter" role="img" aria-label={`${pledged} of ${qty} already promised`}>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <i key={i} className={i < filled ? "meter__seg meter__seg--promised" : "meter__seg"} />
      ))}
    </div>
  )
}
