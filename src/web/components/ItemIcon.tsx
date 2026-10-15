import type { Item } from "../../core/schema"

// One-colour pictograms in the blunt, square-cut style of stencilled relief crates.
const PATHS: Record<Item, string[]> = {
  water: ["M16 3.5c-4 5.4-9 10.6-9 16a9 9 0 0 0 18 0c0-5.4-5-10.6-9-16Z", "M11.5 20.5a4.6 4.6 0 0 0 4 4.2"],
  food: ["M4.5 15.5h23a11.5 11.5 0 0 1-23 0Z", "M11 4.5c-1.8 2.2 1.8 3.8 0 6M16 3.5c-1.8 2.4 1.8 4.2 0 7M21 4.5c-1.8 2.2 1.8 3.8 0 6"],
  ors: ["M8 6h16v21H8z", "M8 10.5h16", "M16 15v8M12 19h8"],
  blankets: ["M4 8h24v7H4zM4 17h24v7H4z", "M9 8v7M14 8v7M19 8v7M24 8v7"],
  clothes: ["M11 4.5 4 8.5l3 5 3.5-1.8V27h11V11.7L25 13.5l3-5-7-4c-.8 2-2.6 3.2-5 3.2S11.8 6.5 11 4.5Z"],
  sanitary: ["M16 26S5.5 19.5 5.5 12.8A5.3 5.3 0 0 1 16 10.4a5.3 5.3 0 0 1 10.5 2.4C26.5 19.5 16 26 16 26Z"],
  medicine: ["M12 4.5h8v7.5h7.5v8H20v7.5h-8V20H4.5v-8H12z"],
  baby_food: ["M13 3.5h6v3.5h-6zM11 7h10v5l2.5 3.5V28h-15V15.5L11 12z", "M8.5 19h4M8.5 23h4"],
  tarpaulin: ["M3.5 26.5 16 5.5l12.5 21z", "M16 5.5v21M9.5 26.5 16 15l6.5 11.5"],
}

export function ItemIcon({ item, className }: { item: Item; className?: string }) {
  return (
    <svg
      className={className ?? "icon"}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinejoin="miter"
      strokeLinecap="square"
      aria-hidden="true"
    >
      {PATHS[item].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
