<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'

import { useScrollLock } from '@/composables/shared/useScrollLock'

// Fullscreen screenshot viewer. Opened by clicking an inline preview
// img (MatchCardExpanded's sources block on the Matches detail panel,
// or UnknownMapsView's source-screenshot rows on the Unknown tab).
// Close via × button (top-left), Escape, or backdrop click.
//
// Stacks above the detail panel via z-index. While open the panel
// underneath becomes `inert` (App.vue wires the prop) so Tab can't
// reach panel controls and clicks fall through to the lightbox
// backdrop, not panel UI.
//
// Escape handling uses a capture-phase document listener so it fires
// BEFORE useModalFocusTrap's bubble-phase Escape on the detail panel
// — without that order, a single Esc would close both modals at once.
//
// Prev/next contract — same listener now also handles screenshot-
// level navigation WITHIN THE SAME MATCH. The parent (App.vue) owns
// the `files` array + `index` and the lightbox emits intent (`prev`
// / `next`); App.vue swaps `filename` accordingly. Clamps at both
// ends — disabled buttons + key no-op at boundaries. The owning
// match never changes from inside the lightbox; cross-match
// navigation requires closing back to the panel and arrow-keying
// match-by-match there.

const props = defineProps<{
  // Filename of the screenshot being viewed; null = closed.
  filename: string | null
  // Pre-computed src URL (App.vue's screenshotURL helper). null
  // when filename is null.
  src: string | null
  // All source files of the match the lightbox was opened against.
  // The parent passes this so the lightbox can render prev/next
  // affordances without reaching back into the Vue tree for the
  // owning record. Defaults to a single-file list so callers that
  // don't care about navigation (legacy / Vitest mounts) still work.
  files?: readonly string[]
  // Index of `filename` within `files`. The parent computes this so
  // the lightbox doesn't have to track the array semantics. -1 is
  // permitted (defensive — e.g. the file was removed mid-view); both
  // arrow buttons render disabled in that state.
  index?: number
}>()

const emit = defineEmits<{ close: []; prev: []; next: [] }>()

// Freeze the page behind the lightbox. It usually stacks over an
// already-locked panel (detail / ignored-files), but lock explicitly so
// it holds regardless of what opened it.
useScrollLock(computed(() => props.filename !== null))

const closeBtnRef = ref<HTMLButtonElement | null>(null)
const lastFocus = ref<HTMLElement | null>(null)

const files = computed<readonly string[]>(() => props.files ?? (props.filename ? [props.filename] : []))
const index = computed(() => props.index ?? -1)
const canPrev = computed(() => index.value > 0)
const canNext = computed(() => index.value >= 0 && index.value < files.value.length - 1)
// Suppress the position caption when the user has only a single
// screenshot to look at — "1 of 1" is noise, not signal.
const showCount = computed(() => files.value.length > 1 && index.value >= 0)

function onKeydown(e: KeyboardEvent) {
  if (props.filename == null) return
  // Keyboard navigation runs from a capture-phase document listener so
  // arrow keys / h / l absorb here before the detail panel's panel-
  // level keydown sees them — otherwise pressing ← inside the open
  // lightbox would walk to the previous *match* in the panel
  // underneath, which is the wrong mental model.
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopImmediatePropagation()
    emit('close')
    return
  }
  if (e.key === 'ArrowLeft' || e.key === 'h') {
    if (!canPrev.value) return
    e.preventDefault()
    e.stopImmediatePropagation()
    emit('prev')
    return
  }
  if (e.key === 'ArrowRight' || e.key === 'l') {
    if (!canNext.value) return
    e.preventDefault()
    e.stopImmediatePropagation()
    emit('next')
    return
  }
}

watch(
  () => props.filename,
  async (next, prev) => {
    if (next != null && prev == null) {
      lastFocus.value =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      // Capture phase wins over the panel's bubble-phase Escape
      // handlers, so the lightbox absorbs Esc before the panel can
      // see it. Without capture, both modals would close on a
      // single press.
      document.addEventListener('keydown', onKeydown, true)
      await nextTick()
      closeBtnRef.value?.focus()
    } else if (next == null && prev != null) {
      document.removeEventListener('keydown', onKeydown, true)
      await nextTick()
      lastFocus.value?.focus()
      lastFocus.value = null
    }
  },
  // immediate: true so a unit-test mount with a non-null filename
  // installs the keydown listener (production always transitions
  // null → non-null through openLightbox, but the test harness mounts
  // straight into the open state for keyboard pins).
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
})

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}

function onPrevClick() {
  if (!canPrev.value) return
  emit('prev')
}
function onNextClick() {
  if (!canNext.value) return
  emit('next')
}
</script>

<template>
  <transition name="lightbox-fade">
    <div
      v-if="filename && src"
      class="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      :aria-label="`Screenshot preview: ${filename}`"
      @click="onBackdropClick"
    >
      <button
        ref="closeBtnRef"
        type="button"
        class="lightbox-close"
        title="Close (Esc)"
        aria-label="Close screenshot preview"
        @click="emit('close')"
      >
        <span aria-hidden="true">×</span>
      </button>
      <span v-if="showCount" class="lightbox-count" aria-live="polite">
        {{ (index ?? 0) + 1 }} of {{ files.length }}
      </span>
      <button
        type="button"
        class="lightbox-prev"
        :disabled="!canPrev"
        title="Previous screenshot (← / h)"
        aria-label="Previous screenshot in this match"
        @click="onPrevClick"
      >
        <span aria-hidden="true">&lt;</span>
      </button>
      <img :src="src" :alt="filename" class="lightbox-img">
      <button
        type="button"
        class="lightbox-next"
        :disabled="!canNext"
        title="Next screenshot (→ / l)"
        aria-label="Next screenshot in this match"
        @click="onNextClick"
      >
        <span aria-hidden="true">&gt;</span>
      </button>
    </div>
  </transition>
</template>

<style scoped>
.lightbox-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgb(0 0 0 / 92%);
  display: grid;
  place-items: center;
  padding: 1.5rem;
  cursor: zoom-out;
}

.lightbox-close {
  position: absolute;
  top: 0.8rem;
  left: 0.8rem;
  width: 2.4rem;
  height: 2.4rem;
  background: rgb(0 0 0 / 65%);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--mono);
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
  border-radius: 4px;
  transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
}

.lightbox-close:hover {
  background: var(--accent-soft);
  color: var(--accent-bright, var(--accent));
  border-color: var(--accent);
}

.lightbox-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Position caption — small monospaced "N of M" pill anchored next to
   the close button. aria-live so screen readers announce the new
   index when prev/next changes the displayed screenshot. */
.lightbox-count {
  position: absolute;
  top: 1.2rem;
  left: 4rem;
  padding: 0.25rem 0.55rem;
  background: rgb(0 0 0 / 65%);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.7rem;
  font-feature-settings: "tnum";
  letter-spacing: 0.08em;
  user-select: none;
}

/* Prev / next buttons sit centred on the left and right edges so the
   user can hit them without travelling far from the image's centre
   of attention. Mirror the close button's palette so the lightbox
   reads as one coherent chrome. Disabled state dims rather than
   hiding — keeps the layout stable as the user walks to the ends. */
.lightbox-prev,
.lightbox-next {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 3rem;
  height: 4.5rem;
  background: rgb(0 0 0 / 65%);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--mono);
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
  border-radius: 4px;
  transition: background 160ms ease, color 160ms ease, border-color 160ms ease, opacity 160ms ease;
}

.lightbox-prev {
  left: 0.8rem;
}

.lightbox-next {
  right: 0.8rem;
}

.lightbox-prev:hover:not(:disabled),
.lightbox-next:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent-bright, var(--accent));
  border-color: var(--accent);
}

.lightbox-prev:focus-visible,
.lightbox-next:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.lightbox-prev:disabled,
.lightbox-next:disabled {
  cursor: default;
  opacity: 0.35;
}

.lightbox-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: 0 8px 32px rgb(0 0 0 / 50%);
  cursor: default;
}

.lightbox-fade-enter-active,
.lightbox-fade-leave-active {
  transition: opacity 180ms ease;
}

.lightbox-fade-enter-from,
.lightbox-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .lightbox-fade-enter-active,
  .lightbox-fade-leave-active {
    transition: none;
  }
}
</style>
