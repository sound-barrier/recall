<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

// Lower-level typeahead primitive. Self-contained: owns the search
// input, the listbox render, and the keyboard navigation
// (Arrow/Home/End/Enter/Escape). Consumers wire it via props +
// emits — they own "is selected" state (multi-select via picked.has,
// single-select via () => false) and what to do on `select`.
//
// Used by `FilterCombobox.vue` (Map / Hero multi-select pickers
// in the Matches narrow panel) and the tag pickers introduced
// for the polish set:
//
//   * Inline tag autocomplete in Match Journal — single-select adopt
//   * Bulk-tag dropdown in BulkActionBar — single-select adopt
//   * Right-click Tag submenu in MatchRowContextMenu — single-select adopt
//
// CSS class names keep the existing `combo-*` shape so FilterCombobox
// tests (and CSS in app.css) stay stable across the extraction.
//
// Open state is parent-owned so a tree of typeahead pickers can
// enforce "only one open at a time" without each instance reaching
// into a shared state.

interface Props {
  listboxId: string
  label: string
  options: string[]
  open: boolean
  placeholder?: string
  emptyMessage?: string
  // Per-option "is selected" predicate. Drives aria-selected + the
  // ✓ checkmark column. Multi-select pickers pass `picked.has`;
  // single-select tag pickers pass `() => false`.
  isSelected?: (opt: string) => boolean
  // Render the ✓ checkmark column. Defaults true (multi-select).
  // Single-select tag pickers pass false for a cleaner row.
  showCheckmark?: boolean
  // Pre-highlight the first match as the user types, so Enter fills it
  // without an extra Tab. Only for FIXED-vocabulary pickers (map / hero)
  // — free-text tag pickers leave it off so Enter coins the typed value
  // instead of hijacking it to the first existing suggestion.
  autoHighlightFirst?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: undefined,
  emptyMessage: 'no matches',
  isSelected: undefined,
  showCheckmark: true,
  autoHighlightFirst: false,
})

function checkSelected(opt: string): boolean {
  return props.isSelected ? props.isSelected(opt) : false
}

const emit = defineEmits<{
  'select':   [value: string]
  'open':     []
  'close':    []
  // Enter on a non-empty search that doesn't match any option emits
  // free-text so tag pickers can adopt a new tag. The parent decides
  // whether to allow free-text (FilterCombobox ignores it; tag
  // pickers wire it to addTag()).
  'free-text': [value: string]
}>()

const search = ref('')
const cursor = ref(-1) // -1 = no highlight; Enter without arrow keypress falls to free-text
const inputEl = ref<HTMLInputElement | null>(null)
const listEl  = ref<HTMLUListElement | null>(null)

const filteredOptions = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.options
  // Prefix match, not substring: typing "an" surfaces "ana", not "busan".
  // Users scan these pickers alphabetically, so first-letter matching is what
  // they expect (and what the tag autocomplete does too).
  return props.options.filter((opt) => opt.toLowerCase().startsWith(q))
})

const effectivePlaceholder = computed(() => {
  if (props.placeholder !== undefined) return props.placeholder
  return `type to search ${props.options.length} items…`
})

const effectiveEmpty = computed(() => props.emptyMessage)

// Reset stale cursor when the filtered list shrinks past it. With
// autoHighlightFirst on, a non-empty query instead pre-selects the first
// match (cursor 0) so Enter fills it with no extra Tab; an empty query
// drops the highlight so Enter on a blank box doesn't grab option 0.
watch(filteredOptions, () => {
  if (props.autoHighlightFirst) {
    cursor.value = search.value.trim() !== '' && filteredOptions.value.length > 0 ? 0 : -1
    return
  }
  if (cursor.value >= filteredOptions.value.length) cursor.value = -1
})

// Closing the dropdown wipes search + cursor so re-opening starts
// clean — a stale "miyazaki" query lingering in a Hero combo when
// reopened for the Map combo would be a confusing leak.
watch(() => props.open, (next, prev) => {
  if (!next && prev) {
    search.value = ''
    cursor.value = -1
  }
})

function onCaretClick() {
  if (props.open) emit('close')
  else            emit('open')
}

function onInputFocus() {
  if (!props.open) emit('open')
}

function onMousedownOption(value: string) {
  emit('select', value)
}

function onKeydown(e: KeyboardEvent) {
  if (!props.open) return
  const len = filteredOptions.value.length
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      cursor.value = len === 0 ? -1 : (cursor.value + 1) % len
      void scrollCursorIntoView()
      break
    case 'ArrowUp':
      e.preventDefault()
      cursor.value = len === 0 ? -1 : (cursor.value - 1 + len) % len
      void scrollCursorIntoView()
      break
    case 'Home':
      e.preventDefault()
      cursor.value = len === 0 ? -1 : 0
      void scrollCursorIntoView()
      break
    case 'End':
      e.preventDefault()
      cursor.value = len === 0 ? -1 : len - 1
      void scrollCursorIntoView()
      break
    case 'Enter': {
      e.preventDefault()
      const hit = cursor.value >= 0 && cursor.value < len
      if (hit) {
        emit('select', filteredOptions.value[cursor.value]!)
      } else if (search.value.trim()) {
        emit('free-text', search.value.trim())
      }
      break
    }
    case 'Tab':
      // Tab completes the typeahead: highlight the next match (Enter then
      // selects it) rather than leaving the field. Only while the dropdown is
      // open with matches — otherwise Tab keeps its normal focus move.
      // Shift+Tab steps back through the matches.
      if (len > 0) {
        e.preventDefault()
        e.stopPropagation()
        cursor.value = e.shiftKey ? (cursor.value - 1 + len) % len : (cursor.value + 1) % len
        void scrollCursorIntoView()
      }
      break
    case 'Escape':
      e.preventDefault()
      emit('close')
      break
  }
}

async function scrollCursorIntoView() {
  await nextTick()
  const list = listEl.value
  if (!list) return
  const item = list.querySelector<HTMLLIElement>(`li[data-td-index="${cursor.value}"]`)
  item?.scrollIntoView({ block: 'nearest' })
}

defineExpose({
  focus: () => inputEl.value?.focus(),
  clear: () => { search.value = ''; cursor.value = -1 },
})
</script>

<template>
  <div class="combo">
    <input
      ref="inputEl"
      v-model="search"
      type="search"
      class="combo-input"
      :placeholder="effectivePlaceholder"
      :aria-controls="listboxId"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-activedescendant="cursor >= 0 && cursor < filteredOptions.length
        ? `${listboxId}-opt-${cursor}` : undefined"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
      role="combobox"
      :aria-label="label"
      @focus="onInputFocus"
      @keydown="onKeydown"
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
    <ul
      v-if="open"
      :id="listboxId"
      ref="listEl"
      class="combo-list"
      role="listbox"
      :aria-label="label"
    >
      <li
        v-for="(opt, i) in filteredOptions"
        :id="`${listboxId}-opt-${i}`"
        :key="opt"
        :data-td-index="i"
        :class="{
          picked: checkSelected(opt),
          cursor: i === cursor,
        }"
        role="option"
        :aria-selected="checkSelected(opt) ? 'true' : 'false'"
        @mousedown.prevent="onMousedownOption(opt)"
        @mouseenter="cursor = i"
      >
        <span v-if="showCheckmark" class="combo-check" aria-hidden="true">{{ checkSelected(opt) ? '✓' : '' }}</span>
        <span class="combo-opt-name">{{ opt }}</span>
      </li>
      <li v-if="!filteredOptions.length" class="combo-empty">
        {{ effectiveEmpty }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
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
  top: 1.18rem;
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

.combo-list li.cursor {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.combo-list li:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.combo-list li.picked {
  color: var(--accent);
  font-weight: 700;
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.combo-list li.picked:hover,
.combo-list li.picked.cursor {
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
