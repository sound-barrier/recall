<script setup lang="ts">
import TypeaheadDropdown from '@/components/shared/TypeaheadDropdown.vue'

// Multi-select typeahead for the Matches narrow panel. Backs the
// Map (31 options) and Hero (51 options) pickers — chip clouds at
// that density become a wall of buttons or scroll behind selected
// chips.
//
// Composition: pills row above + TypeaheadDropdown primitive below.
// The pills carry the multi-select identity (which values are
// active); the primitive owns the listbox + keyboard nav.
//
// Ownership contract (unchanged from pre-extraction):
//
//   * Parent owns `picked` (Set of selected values) + `open` (which
//     combo, if any, is the active one — parent enforces "only one
//     dropdown open at a time").
//   * Toggling a pick emits `toggle` with the value. Parent decides
//     whether to add or remove (typically `useMatchesNarrow`'s
//     pickMap / pickHero pickers, which do the set XOR).

const props = defineProps<{
  comboId: string
  label: string
  options: string[]
  picked: Set<string>
  open: boolean
  placeholder?: string
  emptyMessage?: string
  // Opt-in: badge the first selected pill "primary". Used by the Add-match
  // modal's hero picker, where heroes[0] is the primary; the narrow panel
  // leaves it off (its picks are an unordered filter set).
  firstIsPrimary?: boolean
}>()

const emit = defineEmits<{
  'toggle': [value: string]
  'open':   []
  'close':  []
}>()

function isPicked(opt: string) {
  return props.picked.has(opt)
}

function onSelect(value: string) {
  emit('toggle', value)
}
</script>

<template>
  <div :data-combo-id="comboId" class="filter-combobox">
    <div v-if="picked.size" class="combo-selected">
      <span
        v-for="(v, i) in [...picked]"
        :key="v"
        class="combo-pill"
        :class="{ 'combo-pill-primary': firstIsPrimary && i === 0 }"
      >
        <span v-if="firstIsPrimary && i === 0" class="combo-pill-tag">primary</span>
        {{ v }}
        <button
          type="button"
          class="combo-pill-x"
          :aria-label="`Drop ${v}`"
          @click="emit('toggle', v)"
        >×</button>
      </span>
    </div>
    <TypeaheadDropdown
      :listbox-id="`${comboId}-listbox`"
      :label="label"
      :options="options"
      :open="open"
      :placeholder="placeholder"
      :empty-message="emptyMessage"
      :is-selected="isPicked"
      :show-checkmark="true"
      @select="onSelect"
      @open="emit('open')"
      @close="emit('close')"
    />
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

.combo-pill-primary {
  background: color-mix(in srgb, var(--accent) 30%, transparent);
}

.combo-pill-tag {
  font-size: 0.48rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 700;
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
</style>
