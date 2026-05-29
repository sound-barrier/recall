<script setup lang="ts">
import { computed, ref } from 'vue'

// Reusable typeahead multi-select for the Matches narrow panel.
// Backs the Map (31 options) and Hero (51 options) pickers — chip
// clouds at that density become a wall of buttons or scroll behind
// selected chips. The combobox shape gives the user a search-as-
// you-type list with selected items rendered as removable pills
// above the input.
//
// Ownership contract:
//
//   * Parent owns `picked` (Set of selected values) + `open` (which
//     combo, if any, is the active one — parent enforces "only one
//     dropdown open at a time").
//   * Component owns the internal typeahead text. Filtering happens
//     in-component; parent only passes the full option universe.
//   * Toggling a pick emits `toggle` with the value. Parent decides
//     whether to add or remove (typically `useMatchesNarrow`'s
//     pickMap / pickHero pickers, which do the set XOR).
//
// A11y:
//
//   * Caret button has aria-expanded + aria-label.
//   * Dropdown <ul> has role="listbox" + aria-label.
//   * Each option has role="option" + aria-selected reflecting
//     the picked state.
//   * Option mousedown handlers use .prevent so clicking an option
//     doesn't blur the input → no flicker, dropdown stays open.

const props = defineProps<{
  comboId: string
  label: string
  options: string[]
  picked: Set<string>
  open: boolean
  placeholder?: string
  emptyMessage?: string
}>()

const emit = defineEmits<{
  'toggle': [value: string]
  'open':   []
  'close':  []
}>()

const search = ref('')

const filteredOptions = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter((opt) => opt.toLowerCase().includes(q))
})

const effectivePlaceholder = computed(() => {
  if (props.placeholder) return props.placeholder
  return `type to search ${props.options.length} items…`
})

const effectiveEmpty = computed(() => props.emptyMessage ?? 'no matches')

function onCaretClick() {
  if (props.open) emit('close')
  else            emit('open')
}

function onInputFocus() {
  if (!props.open) emit('open')
}

function toggle(value: string) {
  emit('toggle', value)
}
</script>

<template>
  <div :data-combo-id="comboId" class="filter-combobox">
    <div v-if="picked.size" class="combo-selected">
      <span v-for="v in [...picked]" :key="v" class="combo-pill">
        {{ v }}
        <button
          type="button"
          class="combo-pill-x"
          :aria-label="`Drop ${v}`"
          @click="toggle(v)"
        >×</button>
      </span>
    </div>
    <div class="combo">
      <input
        v-model="search"
        type="search"
        class="combo-input"
        :placeholder="effectivePlaceholder"
        autocomplete="off"
        @focus="onInputFocus"
      >
      <button
        type="button"
        class="combo-caret"
        :class="{ open }"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-label="open ? `Close ${label} list` : `Open ${label} list`"
        @click="onCaretClick"
      >
        ▾
      </button>
      <ul v-if="open" class="combo-list" role="listbox" :aria-label="label">
        <li
          v-for="opt in filteredOptions"
          :key="opt"
          :class="{ picked: picked.has(opt) }"
          role="option"
          :aria-selected="picked.has(opt) ? 'true' : 'false'"
          @mousedown.prevent="toggle(opt)"
        >
          <span class="combo-check" aria-hidden="true">{{ picked.has(opt) ? '✓' : '' }}</span>
          <span class="combo-opt-name">{{ opt }}</span>
        </li>
        <li v-if="!filteredOptions.length" class="combo-empty">
          {{ effectiveEmpty }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.combo-selected {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-bottom: 0.3rem;
}

.combo-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.18rem 0.18rem 0.18rem 0.5rem;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border: 1px solid var(--accent);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--accent);
  font-weight: 700;
  text-transform: lowercase;
}

.combo-pill-x {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--accent);
  padding: 0 0.3rem;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
}

.combo-pill-x:hover { color: var(--text); }

.combo {
  position: relative;
}

.combo-input {
  width: 100%;
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.36rem 2.4rem 0.36rem 0.6rem;
  font-family: var(--mono);
  font-size: 0.74rem;
  color: var(--text);
  outline: 0;
}

.combo-input:focus { border-color: var(--accent); }
.combo-input::placeholder { color: var(--text-faint); }

.combo-caret {
  position: absolute;
  right: 0.25rem;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: 0;
  color: var(--text-faint);
  padding: 0.2rem 0.5rem;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  transition: color 120ms ease, transform 160ms ease;
}

.combo-caret:hover { color: var(--accent); }

.combo-caret.open {
  color: var(--accent);
  transform: translateY(-50%) rotate(180deg);
}

.combo-list {
  list-style: none;
  margin: 0.3rem 0 0;
  padding: 0.2rem 0;
  border: 1px solid var(--accent);
  background: var(--surface);
  border-radius: 2px;
  max-height: 14rem;
  overflow-y: auto;
  box-shadow: 0 12px 24px -16px rgb(0 0 0 / 50%);
}

.combo-list li {
  display: grid;
  grid-template-columns: 1.4rem 1fr;
  align-items: center;
  gap: 0.2rem;
  padding: 0.32rem 0.6rem;
  font-family: var(--mono);
  font-size: 0.74rem;
  color: var(--text);
  cursor: pointer;
}

.combo-list li:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.combo-list li.picked {
  color: var(--accent);
  font-weight: 700;
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.combo-list li.picked:hover {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.combo-check {
  color: var(--accent);
  font-weight: 800;
  text-align: center;
}

.combo-opt-name { text-transform: lowercase; }

.combo-empty {
  font-style: italic;
  color: var(--text-faint);
  padding: 0.4rem 0.6rem !important;
  cursor: default !important;
}

.combo-empty:hover { background: transparent !important; }
</style>
