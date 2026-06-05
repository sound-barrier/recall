<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'

import type { IgnoredScreenshot } from '../api'

// IgnoredFilesPanel — Settings → Advanced → "Manage ignored files."
// Modal dialog listing every row from the suppress-list with the
// screenshot's thumbnail, filename, and ignored-at timestamp. Per-row
// Restore button emits `restore` so App.vue can call UnignoreScreenshot
// + reload; bulk "Re-enable all" emits `restore-all` after a 2-step
// arm/confirm (mirrors the destructive-confirm pattern on the Unknown
// tab's "Delete forever" button + Settings → Clear Database).
//
// On any successful restore (per-row or bulk) the panel shows an
// inline "Run Parse now" link. We don't auto-fire Parse — the user
// may want to restore multiple files across multiple sessions before
// re-parsing.
//
// Focus + Escape handling mirrors MatchScreenshotLightbox: capture-
// phase keydown listener installed on document while open, focus
// returns to the previously-focused element on close.

const props = defineProps<{
  isOpen:        boolean
  screenshots:   IgnoredScreenshot[]
  screenshotURL: (filename: string) => string
}>()

const emit = defineEmits<{
  close:         []
  restore:       [filename: string]
  'restore-all': []
  'run-parse':   []
}>()

// "Re-enable all" two-step arm. First click arms (3 s auto-disarm);
// second click within the window fires `restore-all`.
const ARM_MS = 3000
const armed = ref(false)
let armTimer: ReturnType<typeof setTimeout> | null = null

function disarm() {
  if (armTimer !== null) {
    clearTimeout(armTimer)
    armTimer = null
  }
  armed.value = false
}

function onRestoreAllClick() {
  if (!armed.value) {
    armed.value = true
    armTimer = setTimeout(disarm, ARM_MS)
    return
  }
  disarm()
  showRestoredHint()
  emit('restore-all')
}

// Inline "Run Parse now" hint shown after the most recent restore.
// Resets when the panel closes or a fresh arm starts.
const showRestoredFooter = ref(false)
function showRestoredHint() {
  showRestoredFooter.value = true
}

function onRestoreClick(filename: string) {
  showRestoredHint()
  emit('restore', filename)
}

// Focus + Escape, copied in spirit from MatchScreenshotLightbox.
// Capture-phase listener wins over any panel-level Escape on the
// Settings view underneath.
const dialogRef = ref<HTMLElement | null>(null)
const lastFocus = ref<HTMLElement | null>(null)

function onKeydown(e: KeyboardEvent) {
  if (!props.isOpen) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopImmediatePropagation()
    emit('close')
  }
}

watch(
  () => props.isOpen,
  async (next, prev) => {
    if (next && !prev) {
      lastFocus.value =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      document.addEventListener('keydown', onKeydown, true)
      await nextTick()
      dialogRef.value?.focus()
    } else if (!next && prev) {
      document.removeEventListener('keydown', onKeydown, true)
      disarm()
      showRestoredFooter.value = false
      await nextTick()
      lastFocus.value?.focus()
      lastFocus.value = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
})

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}

// formatIgnoredAt — local-time short form, e.g. "Jun 5, 12:34 PM".
// Empty `ts` shows the empty string (the SQLStore always populates
// timestamps but seeded tests may leave the field blank).
function formatIgnoredAt(ts: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString(undefined, {
    month:  'short',
    day:    'numeric',
    hour:   'numeric',
    minute: '2-digit',
  })
}
</script>

<template>
  <transition name="ignored-panel-fade">
    <div
      v-if="isOpen"
      class="ignored-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ignored-panel-title"
      @click="onBackdropClick"
    >
      <div ref="dialogRef" class="ignored-panel" tabindex="-1">
        <header class="ignored-head">
          <h2 id="ignored-panel-title" class="ignored-title">
            Ignored screenshots
            <span class="ignored-count" aria-label="{{ screenshots.length }} ignored files">{{ screenshots.length }}</span>
          </h2>
          <button
            type="button"
            class="ignored-close"
            title="Close (Esc)"
            aria-label="Close ignored files panel"
            @click="emit('close')"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <p v-if="screenshots.length === 0" class="ignored-empty">
          Nothing ignored. Files you mark as <em>Delete forever</em> on the Unknown tab show up here so you can bring them back.
        </p>

        <template v-else>
          <div class="ignored-toolbar">
            <button
              v-if="!armed"
              type="button"
              class="btn ghost ignored-restore-all"
              @click="onRestoreAllClick"
            >
              Re-enable all ({{ screenshots.length }})
            </button>
            <template v-else>
              <span class="ignored-armed-hint">Confirm?</span>
              <button
                type="button"
                class="btn destructive ignored-restore-all-confirm"
                @click="onRestoreAllClick"
              >
                Yes, re-enable all
              </button>
              <button
                type="button"
                class="btn ghost ignored-restore-all-cancel"
                @click="disarm"
              >
                Cancel
              </button>
            </template>
          </div>

          <ul class="ignored-list">
            <li
              v-for="s in screenshots"
              :key="s.filename"
              class="ignored-row"
            >
              <div class="ignored-thumb-wrap">
                <img
                  :src="screenshotURL(s.filename)"
                  :alt="s.filename"
                  class="ignored-thumb"
                  loading="lazy"
                >
              </div>
              <div class="ignored-meta">
                <div class="ignored-filename mono">{{ s.filename }}</div>
                <div class="ignored-timestamp">{{ formatIgnoredAt(s.ignored_at) }}</div>
              </div>
              <button
                type="button"
                class="btn primary ignored-restore"
                @click="onRestoreClick(s.filename)"
              >
                Restore
              </button>
            </li>
          </ul>
        </template>

        <footer v-if="showRestoredFooter" class="ignored-foot" role="status">
          Restored.
          <button
            type="button"
            class="ignored-runparse"
            @click="emit('run-parse')"
          >
            Run Parse now
          </button>
          to re-discover.
        </footer>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.ignored-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1090;
  background: rgb(0 0 0 / 70%);
  display: grid;
  place-items: center;
  padding: 1.5rem;
}

.ignored-panel {
  width: min(720px, 100%);
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 16px 60px rgb(0 0 0 / 45%);
}

.ignored-panel:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.ignored-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--border-soft, var(--border));
}

.ignored-title {
  font-family: var(--display-font, inherit);
  font-size: 1.05rem;
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.ignored-count {
  display: inline-block;
  padding: 0 0.4rem;
  font-size: 0.78rem;
  line-height: 1.4;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  color: var(--text-dim);
  font-family: var(--mono);
}

.ignored-close {
  appearance: none;
  width: 1.9rem;
  height: 1.9rem;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--mono);
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
  border-radius: 3px;
  transition: background var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

.ignored-close:hover,
.ignored-close:focus-visible {
  background: var(--surface-2);
  border-color: var(--accent);
  outline: none;
}

.ignored-empty {
  padding: 1.75rem 1rem;
  color: var(--text-dim);
  text-align: center;
  margin: 0;
  line-height: 1.5;
}

.ignored-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid var(--border-soft, var(--border));
  background: var(--surface);
}

.ignored-armed-hint {
  font-size: 0.85rem;
  color: var(--text-dim);
}

.ignored-list {
  list-style: none;
  margin: 0;
  padding: 0.4rem 0.5rem;
  overflow-y: auto;
  flex: 1;
}

.ignored-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.85rem;
  padding: 0.55rem 0.5rem;
  border-bottom: 1px solid var(--border-soft, var(--border));
}

.ignored-row:last-child {
  border-bottom: none;
}

.ignored-thumb-wrap {
  width: 96px;
  height: 54px;
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
}

.ignored-thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ignored-meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.ignored-filename {
  font-size: 0.82rem;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ignored-timestamp {
  font-size: 0.72rem;
  color: var(--text-faint);
}

.ignored-restore {
  flex-shrink: 0;
}

.ignored-foot {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.65rem 1rem;
  border-top: 1px solid var(--border-soft, var(--border));
  font-size: 0.85rem;
  color: var(--text-dim);
  background: var(--surface);
}

.ignored-runparse {
  appearance: none;
  background: transparent;
  border: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}

.ignored-runparse:hover,
.ignored-runparse:focus-visible {
  color: var(--accent-bright, var(--accent));
  outline: none;
}

/* Fade-in match — mirrors the lightbox transition shape so the
   panel feels like a peer surface, not a router-shell page change. */
.ignored-panel-fade-enter-active,
.ignored-panel-fade-leave-active {
  transition: opacity var(--duration-fast) ease;
}

.ignored-panel-fade-enter-from,
.ignored-panel-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .ignored-panel-fade-enter-active,
  .ignored-panel-fade-leave-active {
    transition: none;
  }
}
</style>
