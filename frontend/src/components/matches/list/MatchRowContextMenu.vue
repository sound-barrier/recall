<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { useScrollLock } from '@/composables/shared/keyboard/useScrollLock'
import { useWriteGate } from '@/composables/shared/useWriteGate'

// Right-click context menu for a Matches list row. Quick actions
// without first opening the detail panel:
//
//   1. Open detail (same as a left-click on the row).
//   2. Filter from this match / Clear since-anchor (anchor toggle).
//   3. Tag — opens detail panel with the tag input focused so the
//      user can type one tag without leaving the surface.
//   4. Edit annotation — opens detail panel with the note textarea
//      focused. Sibling to Tag for the journal-writing workflow.
//   5. Copy replay code — shown only when the match has one.
//   6. Copy match link — copies the canonical match URL (the match_key
//      pasted as a recall:// URL the desktop app can resolve).
//   7. Open source folder — Wails-only; opens the screenshots dir
//      in the host OS file manager via RevealScreenshotsDir.
//   8. Hide match (soft-delete; same SetMatchVisibility(true) the
//      bulk-action bar uses, so an Unhide path already exists in
//      the detail panel + the Bulk Hidden drawer).
//
// Positioning is fixed-element at (x, y) — the raw mouse
// coordinates of the contextmenu event. The viewport-edge clamp
// is intentionally NOT implemented yet: the menu is small
// (~ 180 × 220 px) and almost never overlaps the edge in real
// use. Add the clamp when a user reports it.

const props = defineProps<{
  position: { x: number; y: number } | null
  matchKey: string
  isAnchor: boolean
  // Optional record-derived shorthand. Used to gate per-row items
  // that need source data (Copy replay code without a replay_code
  // value is meaningless; show the item only when there is one).
  replayCode?: string | null
  // Wails-only: Open source folder gates on IS_WAILS so the server-
  // mode build doesn't surface a no-op menu item.
  isWails?: boolean
}>()

// Freeze the page while the menu is up (position non-null = open) so it
// doesn't scroll away from the row it's anchored to.
useScrollLock(computed(() => props.position !== null))

// Four items write (Tag and Edit annotation open the journal to do it,
// Review this match opens a sitting, Hide flips visibility); the rest read
// or navigate and stay live.
const { writesLocked, lockedTitle, sessionActive } = useWriteGate()

// During a coaching session the row under the cursor is a LOANED match —
// the right sentence is the loan, not "end the session".
const reviewTitle = computed(() => (sessionActive.value
  ? 'This match is on loan — notes go in the film room.'
  : lockedTitle('Review this match in the film room')))

// Sending is a READ, so the write gate is the wrong test — but during a
// session this row is the coach's loaned match, and a bundle of someone
// else's match signed with your handle is worse than a blocked write.
const sendTitle = computed(() => (sessionActive.value
  ? 'This match is on loan — you can only send your own to a coach.'
  : 'Send this match to a coach'))

function onReviewMatch() {
  emit('review-match', props.matchKey)
  emit('close')
}

function onSendToCoach() {
  emit('send-to-coach', props.matchKey)
  emit('close')
}

const emit = defineEmits<{
  close:        []
  'open-detail': [matchKey: string]
  'set-anchor':  [matchKey: string]
  /** Open the Send-to-a-coach dialog over this one match. */
  'send-to-coach': [matchKey: string]
  // Open the detail panel + focus a specific input. App.vue routes
  // these through selection.open + a focus-on-mount hint on the
  // detail panel's exposed methods.
  'open-detail-and-focus-tag':  [matchKey: string]
  'open-detail-and-focus-note': [matchKey: string]
  // Start a self-review sitting over this one match — the film room in
  // your own voice. A write to the player's data, gated like Hide.
  'review-match': [matchKey: string]
  // Copy-to-clipboard pipes. Two flavors so the menu doesn't need
  // to know which canonical link / replay-code shape the parent
  // wants — App.vue does the rendering.
  'copy-replay-code': [matchKey: string]
  'copy-match-link':  [matchKey: string]
  // Open source folder — App.vue invokes RevealScreenshotsDir which
  // opens the configured screenshots dir in the host OS file
  // manager. matchKey is included for future per-record dir
  // resolution.
  'open-source-folder': [matchKey: string]
  hide:                 [matchKey: string]
}>()

const menuRef = ref<HTMLDivElement | null>(null)

function onWindowClick(e: MouseEvent) {
  const target = e.target as Node | null
  if (target && menuRef.value?.contains(target)) return
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

function attach() {
  document.addEventListener('click', onWindowClick, true)
  document.addEventListener('keydown', onKeydown, true)
}

function detach() {
  document.removeEventListener('click', onWindowClick, true)
  document.removeEventListener('keydown', onKeydown, true)
}

watch(() => props.position, async (p) => {
  if (p) {
    attach()
    // Re-measure per open: the item count varies with replayCode/isWails,
    // so a stale correction from the last open would clamp against the
    // wrong height.
    clamped.value = null
    await nextTick()
    correctPosition()
  } else {
    detach()
    clamped.value = null
  }
}, { immediate: true })

onBeforeUnmount(detach)

function onOpenDetail() {
  emit('open-detail', props.matchKey)
  emit('close')
}

function onToggleAnchor() {
  emit('set-anchor', props.isAnchor ? '' : props.matchKey)
  emit('close')
}

function onTag() {
  emit('open-detail-and-focus-tag', props.matchKey)
  emit('close')
}

function onEditAnnotation() {
  emit('open-detail-and-focus-note', props.matchKey)
  emit('close')
}

function onCopyReplay() {
  emit('copy-replay-code', props.matchKey)
  emit('close')
}

function onCopyLink() {
  emit('copy-match-link', props.matchKey)
  emit('close')
}

function onOpenSourceFolder() {
  emit('open-source-folder', props.matchKey)
  emit('close')
}

function onHide() {
  emit('hide', props.matchKey)
  emit('close')
}

// Viewport-edge clamp. Measured, not estimated.
//
// This used to add up a hand-written per-item height against a hand-counted
// item count — and the count said five while seven items always rendered,
// so the menu already ran ~72px past the bottom of the screen before this
// change added an eighth. A constant every new item has to remember to bump
// is a constant that will not be bumped.
//
// The menu is positioned at the raw point first and corrected after mount,
// once it can be measured. The opacity transition covers the one frame.
const EDGE_MARGIN = 8
const clamped = ref<{ left: number; top: number } | null>(null)

function correctPosition(): void {
  const p = props.position
  const box = menuRef.value
  if (!p || !box) return
  const r = box.getBoundingClientRect()
  clamped.value = {
    left: Math.max(EDGE_MARGIN, Math.min(p.x, window.innerWidth - r.width - EDGE_MARGIN)),
    top: Math.max(EDGE_MARGIN, Math.min(p.y, window.innerHeight - r.height - EDGE_MARGIN)),
  }
}

const menuStyle = computed(() => {
  if (!props.position) return {}
  const at = clamped.value ?? { left: props.position.x, top: props.position.y }
  return { left: `${at.left}px`, top: `${at.top}px` }
})

</script>

<template>
  <Teleport to="body">
    <Transition name="match-row-ctx">
      <div
        v-if="position"
        ref="menuRef"
        class="match-row-ctx"
        role="menu"
        data-row-ctx
        :style="menuStyle"
      >
        <button
          type="button"
          role="menuitem"
          class="match-row-ctx-item"
          data-row-ctx-open
          @click="onOpenDetail"
        >
          <span class="match-row-ctx-glyph" aria-hidden="true">↗</span>
          Open detail
        </button>
        <button
          type="button"
          role="menuitem"
          class="match-row-ctx-item"
          :class="{ 'is-anchor': isAnchor }"
          data-row-ctx-anchor
          @click="onToggleAnchor"
        >
          <span class="match-row-ctx-glyph" aria-hidden="true">{{ isAnchor ? '◆' : '◇' }}</span>
          {{ isAnchor ? 'Clear since-anchor' : 'Filter from this match' }}
        </button>

        <div class="match-row-ctx-sep" role="separator" aria-hidden="true" />

        <button
          type="button"
          role="menuitem"
          class="match-row-ctx-item"
          data-row-ctx-review
          :disabled="writesLocked"
          :title="reviewTitle"
          @click="onReviewMatch"
        >
          <span class="match-row-ctx-glyph" aria-hidden="true">🎞</span>
          Review this match
        </button>
        <button
          type="button"
          role="menuitem"
          class="match-row-ctx-item"
          data-row-ctx-tag
          :disabled="writesLocked"
          :title="lockedTitle('Open the journal with the tag field focused')"
          @click="onTag"
        >
          <span class="match-row-ctx-glyph" aria-hidden="true">#</span>
          Tag…
        </button>
        <button
          type="button"
          role="menuitem"
          class="match-row-ctx-item"
          data-row-ctx-edit-annotation
          :disabled="writesLocked"
          :title="lockedTitle('Open the journal with the note focused')"
          @click="onEditAnnotation"
        >
          <span class="match-row-ctx-glyph" aria-hidden="true">✎</span>
          Edit annotation
        </button>

        <div class="match-row-ctx-sep" role="separator" aria-hidden="true" />

        <button
          v-if="replayCode"
          type="button"
          role="menuitem"
          class="match-row-ctx-item"
          data-row-ctx-copy-replay
          @click="onCopyReplay"
        >
          <span class="match-row-ctx-glyph" aria-hidden="true">⎘</span>
          Copy replay code
        </button>
        <button
          type="button"
          role="menuitem"
          class="match-row-ctx-item"
          data-row-ctx-copy-link
          @click="onCopyLink"
        >
          <span class="match-row-ctx-glyph" aria-hidden="true">⎘</span>
          Copy match link
        </button>
        <button
          type="button"
          role="menuitem"
          class="match-row-ctx-item"
          data-row-ctx-send-coach
          :disabled="sessionActive"
          :title="sendTitle"
          @click="onSendToCoach"
        >
          <span class="match-row-ctx-glyph" aria-hidden="true">↗</span>
          Send to a coach…
        </button>
        <button
          v-if="isWails"
          type="button"
          role="menuitem"
          class="match-row-ctx-item"
          data-row-ctx-open-folder
          @click="onOpenSourceFolder"
        >
          <span class="match-row-ctx-glyph" aria-hidden="true">📁</span>
          Open source folder
        </button>

        <div class="match-row-ctx-sep" role="separator" aria-hidden="true" />

        <button
          type="button"
          role="menuitem"
          class="match-row-ctx-item is-danger"
          data-row-ctx-hide
          :disabled="writesLocked"
          :title="lockedTitle('Move this match to the archive')"
          @click="onHide"
        >
          <span class="match-row-ctx-glyph" aria-hidden="true">×</span>
          Hide match
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.match-row-ctx {
  position: fixed;
  z-index: 130;
  min-width: 200px;
  padding: var(--space-1);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  box-shadow: 0 16px 32px -16px rgb(var(--shadow-rgb) / 50%);
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  isolation: isolate;
}

.match-row-ctx-item {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.6rem;
  font-family: var(--mono);
  font-size: var(--type-sm);
  letter-spacing: 0.08em;
  font-weight: 600;
  text-align: left;
  color: var(--text);
  background: transparent;
  border: 0;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--duration-instant) ease, color var(--duration-instant) ease;
}

.match-row-ctx-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.match-row-ctx-item:hover,
.match-row-ctx-item:focus-visible {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent-text);
  outline: none;
}

.match-row-ctx-item.is-anchor .match-row-ctx-glyph {
  color: var(--accent-text);
}

.match-row-ctx-item.is-danger:hover,
.match-row-ctx-item.is-danger:focus-visible {
  background: color-mix(in srgb, var(--loss) 14%, transparent);
  color: var(--loss);
}

.match-row-ctx-item.is-danger:hover .match-row-ctx-glyph,
.match-row-ctx-item.is-danger:focus-visible .match-row-ctx-glyph {
  color: var(--loss);
}

.match-row-ctx-sep {
  height: 1px;
  margin: 0.2rem 0.4rem;
  background: color-mix(in srgb, var(--border) 70%, transparent);
}

.match-row-ctx-glyph {
  font-size: var(--type-lg);
  color: var(--text-dim);
  line-height: 1;
}

.match-row-ctx-enter-active,
.match-row-ctx-leave-active {
  transition: opacity var(--duration-instant) ease;
}

.match-row-ctx-enter-from,
.match-row-ctx-leave-to {
  opacity: 0;
}
</style>
