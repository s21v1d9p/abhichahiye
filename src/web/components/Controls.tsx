import { useEffect, useState } from "react"
import { ITEMS } from "../../core/schema"
import { DISTRICT_SUGGESTIONS } from "../lib/config"
import { ITEM_LABELS, titleCase } from "../lib/labels"
import { useBoard } from "../lib/store"
import { ItemIcon } from "./ItemIcon"

export function Controls() {
  const { district, setDistrict, filters, setFilters } = useBoard()
  const [draft, setDraft] = useState(titleCase(district))
  useEffect(() => setDraft(titleCase(district)), [district])

  return (
    <form
      className="controls"
      onSubmit={(e) => {
        e.preventDefault()
        setDistrict(draft)
      }}
    >
      <label className="field">
        <span className="field__label">District</span>
        <input
          className="field__input"
          list="district-suggestions"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft.trim() && draft.trim().toLowerCase() !== district && setDistrict(draft)}
          placeholder="Type a district"
          autoComplete="off"
        />
        <datalist id="district-suggestions">
          {DISTRICT_SUGGESTIONS.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      </label>

      <fieldset className="chips">
        <legend className="field__label">How urgent</legend>
        <div className="chips__row">
          {([[1, "All needs"], [2, "Urgent and critical"], [3, "Critical only"]] as const).map(([level, label]) => (
            <button key={level} type="button" className="chip" aria-pressed={filters.minUrgency === level} onClick={() => setFilters({ minUrgency: level })}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="chips chips--trust">
        <legend className="field__label">Whose posts</legend>
        <div className="chips__row">
          <button type="button" className="chip" aria-pressed={filters.view === "open"} onClick={() => setFilters({ view: "open" })}>
            Everyone
          </button>
          <button
            type="button"
            className="chip chip--tarp"
            aria-pressed={filters.view === "verified"}
            onClick={() => setFilters({ view: "verified" })}
            title="Asks Arkiv only for entities created by organisations a district authority vouched for. Spam and impostors never reach this view."
          >
            Vouched only
          </button>
        </div>
      </fieldset>

      <fieldset className="chips chips--items">
        <legend className="field__label">What</legend>
        <div className="chips__row">
          <button type="button" className="chip" aria-pressed={filters.item === "all"} onClick={() => setFilters({ item: "all" })}>
            Everything
          </button>
          {ITEMS.map((item) => (
            <button key={item} type="button" className="chip chip--item" aria-pressed={filters.item === item} onClick={() => setFilters({ item })}>
              <ItemIcon item={item} className="chip__icon" />
              {ITEM_LABELS[item].en}
            </button>
          ))}
        </div>
      </fieldset>
    </form>
  )
}
