<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'

import { useCommandPalette } from '@/composables/app/useCommandPalette'
import { useModalFocusTrap } from '@/composables/shared/keyboard/useModalFocusTrap'

// ⌘K / Ctrl+K palette — jump to a view or a match without reaching for the
// mouse.
//
// It lives in components/shared because it is genuinely cross-feature: it
// searches the tab set AND the match corpus, and belongs to no single view.
//
// A dialog wrapping a listbox, which is the pattern the roles describe: the box
// is the dialog, the input owns the combobox semantics and points at the list
// via aria-controls, and the active row is named by aria-activedescendant so a
// screen reader follows the cursor without focus ever leaving the input.
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { query, results, cursor, move, run, close } = useCommandPalette()

const openRef = toRef(props, 'open')
// The trap gives us focus containment and return-focus. Its Esc is bubble
// phase, which is the wrong phase for a modal that can STACK: the detail panel
// beneath has its own bubble-phase Esc, and the two would both run.
useModalFocusTrap(openRef, {
  containerSelector: '.cmdk-box',
  onClose: () => { close(); emit('close') },
})

// Esc at CAPTURE phase, ahead of every bubble-phase listener in the app.
// Without it, opening the palette over a match detail panel meant the panel's
// own keyboard handler saw the query field as an editable target first,
// blurred it, and closed nothing — so the first Esc did nothing visible and
// the second closed the palette AND the match underneath it. The repo pattern
// is the same one MatchScreenshotLightbox and KeyboardShortcutsModal use.
function onCaptureKey(e: KeyboardEvent) {
  if (!props.open || e.key !== 'Escape') return
  e.preventDefault()
  e.stopImmediatePropagation()
  close()
  emit('close')
}

onMounted(() => { document.addEventListener('keydown', onCaptureKey, true) })
onBeforeUnmount(() => { document.removeEventListener('keydown', onCaptureKey, true) })

const input = ref<HTMLInputElement | null>(null)

// Focus the field on open, and reset the query — a palette that reopens holding
// the last search makes the user clear it before every use.
watch(openRef, async (isOpen) => {
  if (!isOpen) return
  query.value = ''
  cursor.value = 0
  await nextTick()
  input.value?.focus()
}, { immediate: true })

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
  else if (e.key === 'Enter') { e.preventDefault(); if (run()) emit('close') }
}

// Split a label around its matched characters so the user can see WHY a row
// matched. A result whose match is invisible reads as a random suggestion.
function segments(label: string, hits: number[]): { text: string; hit: boolean }[] {
  const set = new Set(hits)
  const out: { text: string; hit: boolean }[] = []
  for (let i = 0; i < label.length; i++) {
    const hit = set.has(i)
    const last = out[out.length - 1]
    if (last && last.hit === hit) last.text += label[i]
    else out.push({ text: label[i] ?? '', hit })
  }
  return out
}
</script>

<template>
  <div v-if="open" class="cmdk-backdrop" @click.self="emit('close')">
    <div class="cmdk-box" role="dialog" aria-modal="true" aria-label="Command palette">
      <input
        ref="input"
        v-model="query"
        class="cmdk-input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        role="combobox"
        aria-expanded="true"
        aria-controls="cmdk-list"
        :aria-activedescendant="results[cursor] ? `cmdk-opt-${cursor}` : undefined"
        aria-label="Search views and matches"
        placeholder="Jump to a view or a match…"
        @keydown="onKeydown"
      >
      <ul id="cmdk-list" class="cmdk-list" role="listbox" aria-label="Results">
        <li
          v-for="(r, i) in results"
          :id="`cmdk-opt-${i}`"
          :key="r.id"
          class="cmdk-opt"
          :class="{ active: i === cursor }"
          role="option"
          :aria-selected="i === cursor"
          @click="run(r); emit('close')"
        >
          <span class="cmdk-label">
            <template v-for="(seg, si) in segments(r.label, r.hits)" :key="si">
              <mark v-if="seg.hit" class="cmdk-hit">{{ seg.text }}</mark>
              <template v-else>{{ seg.text }}</template>
            </template>
          </span>
          <span class="cmdk-hint">{{ r.hint }}</span>
        </li>
      </ul>
      <p v-if="results.length === 0" class="cmdk-empty" role="status">
        Nothing matches “{{ query }}”.
      </p>
    </div>
  </div>
</template>

<style scoped>
.cmdk-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: flex;
  justify-content: center;
  padding-top: 12vh;
  background: rgb(var(--shadow-rgb) / 55%);
}

.cmdk-box {
  width: min(34rem, 92vw);
  height: fit-content;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.cmdk-input {
  width: 100%;
  padding: 0.7rem 0.9rem;
  font-size: var(--type-lg);
  color: var(--text);
  background: var(--surface-2);
  border: 0;
  border-bottom: 1px solid var(--border);
}

.cmdk-list {
  max-height: 50vh;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.cmdk-opt {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.45rem 0.9rem;
  cursor: pointer;
}

.cmdk-opt.active,
.cmdk-opt:hover {
  background: var(--surface-3);
}

.cmdk-label {
  flex: 1 1 auto;
  font-size: var(--type-md);
  color: var(--text);
}

/* The matched characters, so the reason a row is here is visible. */
.cmdk-hit {
  background: none;
  color: var(--accent-text);
  font-weight: 700;
}

.cmdk-hint {
  flex: none;
  font-size: var(--type-2xs);
  color: var(--text-dim);
}

.cmdk-empty {
  margin: 0;
  padding: 0.7rem 0.9rem;
  font-size: var(--type-sm);
  color: var(--text-dim);
}
</style>
