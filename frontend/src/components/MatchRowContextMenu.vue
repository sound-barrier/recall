<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

// Right-click context menu for a Matches list row. Lets users
// stamp the "since" anchor directly from the list without first
// opening the detail panel — useful for power users who already
// know which match they want to mark as their reference. The
// menu offers two actions today (Open detail, Filter from this
// match / Clear) and is structured so adding a third (e.g.
// "Hide match") later is a one-line addition.
//
// Positioning is fixed-element at (x, y) — usually the raw mouse
// coordinates of the contextmenu event. The viewport-edge clamp
// is intentionally NOT implemented yet: the menu is small (~ 160
// × 80 px) and almost never overlaps the viewport edge in real
// use. Add the clamp when a user reports it.

const props = defineProps<{
  position: { x: number; y: number } | null
  matchKey: string
  isAnchor: boolean
}>()

const emit = defineEmits<{
  close:        []
  'open-detail': [matchKey: string]
  'set-anchor':  [matchKey: string]
}>()

const menuRef = ref<HTMLDivElement | null>(null)

function onWindowClick(e: MouseEvent) {
  // Click inside the menu = handled by the item buttons; ignore.
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
  // Capture-phase click so the menu closes BEFORE other capture-
  // phase handlers consume the event (e.g. modal focus traps).
  document.addEventListener('click', onWindowClick, true)
  document.addEventListener('keydown', onKeydown, true)
}

function detach() {
  document.removeEventListener('click', onWindowClick, true)
  document.removeEventListener('keydown', onKeydown, true)
}

watch(() => props.position, (p) => {
  if (p) {
    attach()
  } else {
    detach()
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
        :style="{ left: position.x + 'px', top: position.y + 'px' }"
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
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.match-row-ctx {
  position: fixed;
  z-index: 130;
  min-width: 180px;
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

.match-row-ctx-glyph {
  font-size: 0.85rem;
  color: var(--text-dim);
  line-height: 1;
}

/* Fade-in only — fades are cheap and the menu lifetime is short. */
.match-row-ctx-enter-active,
.match-row-ctx-leave-active {
  transition: opacity 110ms ease;
}

.match-row-ctx-enter-from,
.match-row-ctx-leave-to {
  opacity: 0;
}
</style>
