<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

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

const emit = defineEmits<{
  close:        []
  'open-detail': [matchKey: string]
  'set-anchor':  [matchKey: string]
  // Open the detail panel + focus a specific input. App.vue routes
  // these through selection.open + a focus-on-mount hint on the
  // detail panel's exposed methods.
  'open-detail-and-focus-tag':  [matchKey: string]
  'open-detail-and-focus-note': [matchKey: string]
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

watch(() => props.position, (p) => {
  if (p) attach()
  else   detach()
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

// Viewport-edge clamp — the original menu was small (~110 px tall)
// and rarely overlapped the edge in real use, so the clamp was
// deferred. After item 7 the menu is taller (~260 px with all 8
// actions) and right-clicks near the bottom of the leaves list
// would render off-screen. Estimate the menu size and shift the
// origin upward / leftward if the natural position would clip.
const MENU_W = 220
const MENU_H_BASE = 90  // header rows that always render
const MENU_H_PER_ITEM = 36
function clampedPosition(p: { x: number; y: number }): { left: string; top: string } {
  if (typeof window === 'undefined') return { left: `${p.x}px`, top: `${p.y}px` }
  // Estimate the live menu height — every menu item adds the same
  // ~36px; the gated items (Copy replay code, Open source folder)
  // only render under their conditions so the estimate adapts.
  let itemCount = 5 // Open detail, Anchor, Tag, Edit annotation, Copy link, Hide (always-on)
  if (props.replayCode) itemCount++
  if (props.isWails)    itemCount++
  const h = MENU_H_BASE + itemCount * MENU_H_PER_ITEM
  const w = MENU_W
  const margin = 8
  const maxX = window.innerWidth  - w - margin
  const maxY = window.innerHeight - h - margin
  const left = Math.max(margin, Math.min(p.x, maxX))
  const top  = Math.max(margin, Math.min(p.y, maxY))
  return { left: `${left}px`, top: `${top}px` }
}

const menuStyle = computed(() => {
  if (!props.position) return {}
  return clampedPosition(props.position)
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
          data-row-ctx-tag
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
  padding: 0.25rem;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 2px;
  box-shadow: 0 16px 32px -16px rgb(0 0 0 / 50%);
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
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  font-weight: 600;
  text-align: left;
  color: var(--text);
  background: transparent;
  border: 0;
  border-radius: 2px;
  cursor: pointer;
  transition: background 100ms ease, color 100ms ease;
}

.match-row-ctx-item:hover,
.match-row-ctx-item:focus-visible {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
  outline: none;
}

.match-row-ctx-item.is-anchor .match-row-ctx-glyph {
  color: var(--accent);
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
  font-size: 0.85rem;
  color: var(--text-dim);
  line-height: 1;
}

.match-row-ctx-enter-active,
.match-row-ctx-leave-active {
  transition: opacity 110ms ease;
}

.match-row-ctx-enter-from,
.match-row-ctx-leave-to {
  opacity: 0;
}
</style>
