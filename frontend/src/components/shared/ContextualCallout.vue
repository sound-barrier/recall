<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

// ContextualCallout renders a small floating card anchored to a
// target element. Unlike the full OnboardingTour the callout
// surfaces just-in-time when a specific gate flips — see
// useContextualCallout — and dismisses on Esc / close-glyph / the
// inline CTA. It deliberately does NOT spotlight or block the page
// (the full tour does that; the contextual callout is a hint, not
// a forced gate).
//
// WCAG 2.4.11: the callout is anchored OFFSET from the target
// rect, not overlaid on it — keyboard nav landing on the target
// still surfaces the target's native focus ring underneath. No
// background dimming, no inert tree.

const props = defineProps<{
  // CSS selector of the anchor element. The callout positions itself
  // beside the anchor; if the selector doesn't resolve at mount, the
  // callout stays hidden (no orphan floating card).
  target: string
  // Heading + body copy. Both are short — the callout is one
  // thought. Body wraps at ~36ch.
  heading: string
  body:    string
  // Optional inline action button label. When set, the button fires
  // an `action` event and the parent decides what to do (navigate,
  // emit, dismiss). When omitted, only the close glyph + Esc
  // dismiss.
  actionLabel?: string
  // Preferred placement; defaults to bottom. If there's not enough
  // room the callout falls back to top.
  placement?: 'top' | 'bottom'
}>()

const emit = defineEmits<{
  dismiss: []
  action:  []
}>()

const calloutEl = ref<HTMLDivElement | null>(null)

interface Pos { top: number; left: number; placement: 'top' | 'bottom' }
const pos = ref<Pos | null>(null)

function findAnchor(): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>(props.target)
  } catch (_) {
    return null
  }
}

const SAFETY = 12
const GAP    = 14
const W      = 320

function reposition(): void {
  const anchor = findAnchor()
  if (!anchor || !calloutEl.value) {
    pos.value = null
    return
  }
  const rect = anchor.getBoundingClientRect()
  const callH = calloutEl.value.getBoundingClientRect().height || 120
  const prefer = props.placement ?? 'bottom'
  const roomBelow = window.innerHeight - (rect.bottom + GAP + callH + SAFETY)
  const roomAbove = rect.top - GAP - callH - SAFETY
  const useBottom = prefer === 'bottom' ? roomBelow >= 0 : roomAbove < 0
  const top = useBottom ? rect.bottom + GAP : rect.top - GAP - callH
  // Centre horizontally on the anchor, clamped to viewport.
  let left = rect.left + rect.width / 2 - W / 2
  if (left < SAFETY) left = SAFETY
  if (left + W > window.innerWidth - SAFETY) left = window.innerWidth - W - SAFETY
  pos.value = { top, left, placement: useBottom ? 'bottom' : 'top' }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('dismiss')
  }
}

let raf = 0
function scheduleReposition(): void {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(reposition)
}

onMounted(async () => {
  await nextTick()
  reposition()
  window.addEventListener('scroll', scheduleReposition, true)
  window.addEventListener('resize', scheduleReposition)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('scroll', scheduleReposition, true)
  window.removeEventListener('resize', scheduleReposition)
  document.removeEventListener('keydown', onKeydown)
})

// Re-position when the target prop changes (rare, but supported).
watch(() => props.target, scheduleReposition)

const calloutStyle = computed(() => {
  if (!pos.value) return { display: 'none' }
  return {
    top:  `${pos.value.top}px`,
    left: `${pos.value.left}px`,
    width: `${W}px`,
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="calloutEl"
      class="ctx-callout"
      :class="pos ? `ctx-place-${pos.placement}` : 'ctx-place-bottom'"
      :style="calloutStyle"
      role="dialog"
      aria-modal="false"
      :aria-labelledby="`ctx-callout-${target}-h`"
      data-ctx-callout
    >
      <header class="ctx-head">
        <h3 :id="`ctx-callout-${target}-h`" class="ctx-heading">
          {{ heading }}
        </h3>
        <button
          class="ctx-close"
          type="button"
          aria-label="Dismiss this hint"
          @click="emit('dismiss')"
        >
          ×
        </button>
      </header>
      <p class="ctx-body">
        {{ body }}
      </p>
      <div v-if="actionLabel" class="ctx-actions">
        <button
          type="button"
          class="ctx-action"
          @click="emit('action')"
        >
          {{ actionLabel }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-callout {
  position: fixed;
  z-index: 180;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 3px;
  padding: 0.85rem 1rem 0.95rem;
  box-shadow:
    0 16px 36px color-mix(in srgb, var(--bg) 60%, transparent),
    0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent);
  font-family: var(--sans);
}

.ctx-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.ctx-heading {
  margin: 0;
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: 1.05rem;
  font-style: italic;
  letter-spacing: 0.02em;
  color: var(--text);
}

.ctx-close {
  appearance: none;
  background: transparent;
  border: none;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.3rem;
  transition: color var(--duration-fast) ease;
}

.ctx-close:hover,
.ctx-close:focus-visible {
  color: var(--text);
  outline: none;
}

.ctx-body {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  color: var(--text-dim);
  line-height: 1.5;
}

.ctx-actions {
  margin-top: 0.7rem;
  display: flex;
  justify-content: flex-end;
}

.ctx-action {
  appearance: none;
  background: var(--accent);
  border: 1px solid var(--accent);
  color: var(--primary-text-on-accent, var(--bg));
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.4rem 0.85rem;
  border-radius: 2px;
  cursor: pointer;
  transition: filter var(--duration-fast) ease;
}

.ctx-action:hover,
.ctx-action:focus-visible {
  filter: brightness(1.12);
  outline: none;
}

/* Small arrow tip drawn as a CSS triangle pointing back at the
   anchor element. Hidden in reduced-motion environments where the
   spatial relationship is communicated by the body copy alone. */
.ctx-callout::before {
  content: '';
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left:  6px solid transparent;
  border-right: 6px solid transparent;
}

.ctx-place-bottom::before {
  top: -7px;
  border-bottom: 7px solid var(--accent);
}

.ctx-place-top::before {
  bottom: -7px;
  border-top: 7px solid var(--accent);
}
</style>
