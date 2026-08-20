<script setup lang="ts">
import { nextTick, ref } from 'vue'

import type { FocusItem } from '@/api'
import { SAVE_LABEL, type CoachSaveState } from '@/components/coach/room/coach-room-props'
import { emptyFocusItem, insertAfter, moveBy, removeAt, withText } from '@/match/reviews/focus-items'

// The sheet's "what to work on" — a list, one row per thing, not a
// paragraph. A coach reads these as the items they are handing over and a
// player reads them as what they are on next; either way a row is a row,
// which is what lets a live session say three of them out loud.
//
// CONTROLLED, like the note editor: every edit emits the whole list. The
// autosave lives with whoever owns the list.

const props = withDefaults(defineProps<{
  id: string
  items: FocusItem[]
  saveState?: CoachSaveState
  /** Non-empty when the list cannot be saved — the rows refuse typing rather than lose them. */
  blockedReason?: string
  label?: string
  placeholder?: string
  /** Print the save-state line. Off where a shared header save already speaks. */
  showStatus?: boolean
}>(), {
  saveState: 'idle', blockedReason: '', label: 'What to work on',
  placeholder: 'One thing to take into the next session…',
  showStatus: true,
})

const emit = defineEmits<{ update: [items: FocusItem[]] }>()

const rows = ref<HTMLInputElement[]>([])
const blocked = () => props.blockedReason !== ''

/**
 * Capture a row's field. A function ref rather than a named one: the rows
 * are a v-for, and a removed row would otherwise leave its element behind
 * (Vue rewrites the surviving callbacks' indices but never shortens the
 * array), which is why the list is trimmed to length before every focus.
 */
function setRow(el: unknown, index: number): void {
  if (el instanceof HTMLInputElement) rows.value[index] = el
}

function focusRow(index: number): void {
  void nextTick(() => {
    rows.value.length = props.items.length
    rows.value[index]?.focus()
  })
}

function onInput(index: number, e: Event): void {
  if (!(e.target instanceof HTMLInputElement)) return
  emit('update', withText(props.items, index, e.target.value))
}

function addRow(): void {
  if (blocked()) return
  emit('update', [...props.items, emptyFocusItem()])
  focusRow(props.items.length)
}

function remove(index: number): void {
  if (blocked()) return
  emit('update', removeAt(props.items, index))
  focusRow(Math.max(0, index - 1))
}

/**
 * Reorder, and keep the finger on the button. Sending focus to the row's
 * text field instead made moving an item three places up read ↑ Tab ↑ Tab ↑
 * rather than ↑↑↑ — and these are buttons rather than a drag handle
 * precisely because they answer to a keyboard.
 */
function move(index: number, delta: number): void {
  if (blocked()) return
  emit('update', moveBy(props.items, index, delta))
  const direction = delta < 0 ? 'up' : 'down'
  void nextTick(() => {
    document.querySelector<HTMLButtonElement>(
      `[aria-label="Move item ${index + delta + 1} ${direction}"]`)?.focus()
  })
}

/**
 * Enter opens the next row and Backspace on an empty one closes it — the
 * two things every list editor does, so a whole list can be typed without
 * reaching for the mouse.
 */
function onRowKeydown(index: number, e: KeyboardEvent): void {
  if (blocked()) return
  if (e.key === 'Enter') {
    e.preventDefault()
    emit('update', insertAfter(props.items, index))
    focusRow(index + 1)
    return
  }
  const empty = props.items[index]?.text === ''
  if (e.key === 'Backspace' && empty && props.items.length > 1) {
    e.preventDefault()
    remove(index)
  }
}
</script>

<template>
  <div class="sheet-block">
    <p :id="`${id}-label`" class="eyebrow ink">
      {{ label }}
    </p>
    <ul class="focus-list" :aria-labelledby="`${id}-label`">
      <li v-for="(item, i) in items" :key="item.item_id" class="focus-row">
        <span class="focus-mark" aria-hidden="true">•</span>
        <input
          :id="`${id}-${i}`"
          :ref="(el) => setRow(el, i)"
          class="focus-text"
          type="text"
          maxlength="2000"
          :value="item.text"
          :disabled="blocked()"
          :title="blockedReason || undefined"
          :aria-label="`${label}, item ${i + 1}`"
          :placeholder="i === 0 ? placeholder : ''"
          @input="onInput(i, $event)"
          @keydown="onRowKeydown(i, $event)"
        >
        <span class="focus-tools">
          <button
            type="button" class="paper-chip focus-tool"
            :disabled="blocked() || i === 0"
            :aria-label="`Move item ${i + 1} up`"
            @click="move(i, -1)"
          >↑</button>
          <button
            type="button" class="paper-chip focus-tool"
            :disabled="blocked() || i === items.length - 1"
            :aria-label="`Move item ${i + 1} down`"
            @click="move(i, 1)"
          >↓</button>
          <button
            type="button" class="paper-chip focus-tool"
            :disabled="blocked()"
            :aria-label="`Remove item ${i + 1}`"
            @click="remove(i)"
          >×</button>
        </span>
      </li>
    </ul>
    <button type="button" class="paper-chip focus-add" :disabled="blocked()" @click="addRow">
      + Add an item
    </button>
    <p v-if="showStatus" class="sheet-summary-status" role="status" aria-label="Focus list save state">
      {{ blockedReason || SAVE_LABEL[saveState] }}
    </p>
  </div>
</template>

<style scoped>
.sheet-block {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  align-items: flex-start;
}

.focus-list {
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.focus-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.focus-mark {
  flex: none;
  color: var(--ink-faint);
}

.focus-text {
  flex: 1;
  min-width: 0;
  padding: 0.35rem 0.5rem;
  font-family: var(--body);
  font-size: var(--type-lg);
  color: var(--ink);
  background: var(--paper-2);
  border: 1px solid var(--ink-faint);
  border-radius: var(--radius);
}

.focus-tools {
  flex: none;
  display: flex;
  gap: 0.2rem;
}

.focus-tool {
  min-width: 1.6rem;
}

.focus-add {
  margin-top: 0.15rem;
}
</style>
