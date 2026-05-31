<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

import type { CalloutPlacement } from '../composables/useOnboardingTour'

// Anchored callout panel. Renders the step's tag / number / heading
// / body plus the Skip / Back / Next controls. Anchors to the
// spotlighted target — or centres in the viewport when no target
// exists (Welcome / Done).
//
// Auto-placement: when placement is 'auto' (default for unspecified
// steps), the callout tries bottom → right → left → top in order,
// picking the first side with enough room to fit. A SAFETY_MARGIN
// keeps the callout off the viewport edges.
//
// A dashed connector line draws from the callout toward the target.
// Drawn as an SVG path with `stroke-dasharray` for the brutalist /
// tactical aesthetic — matches the viewfinder corner brackets the
// spotlight component owns.

const props = defineProps<{
  // CSS selector of the spotlighted target. The callout reads this
  // for placement geometry; if null/empty the callout centres.
  target: string | null | undefined
  // Preferred placement; auto picks the side with the most room.
  placement?: CalloutPlacement
  // Step metadata for rendering. Owned by useOnboardingTour.
  eyebrow:   string
  num:       string
  heading:   string
  body:      string
  // Counter copy ("3 of 12").
  counter:   string
  // Button state.
  canBack:   boolean
  isLast:    boolean
}>()

const emit = defineEmits<{
  back:   []
  next:   []
  skip:   []
  finish: []
}>()

const CALLOUT_W = 360
// Min CALLOUT_H is dynamic — we estimate from the actual rendered
// height after mount. Until then we pick a reasonable default for
// initial placement calculations.
const CALLOUT_H_INITIAL = 200
const SAFETY = 16
const GAP    = 22  // gap between target and callout

// Geometry — viewport-relative pixel positions. The callout is
// position: fixed; left/top are derived from `pos`.
const pos = ref({ left: 0, top: 0, placement: 'bottom' as CalloutPlacement })
const calloutEl = ref<HTMLDivElement | null>(null)

function getTargetRect(): { x: number; y: number; w: number; h: number } | null {
  if (!props.target) return null
  let el: HTMLElement | null = null
  try { el = document.querySelector(props.target) as HTMLElement | null } catch { /* invalid selector */ }
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

function calloutHeight(): number {
  return calloutEl.value?.offsetHeight ?? CALLOUT_H_INITIAL
}

// Compute placement geometry. Returns the chosen viewport coords.
function computePos(): { left: number; top: number; placement: CalloutPlacement } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const t = getTargetRect()
  const h = calloutHeight()

  // No target → centre.
  if (!t) {
    return {
      left: Math.max(SAFETY, (vw - CALLOUT_W) / 2),
      top:  Math.max(SAFETY, (vh - h) / 2),
      placement: 'auto',
    }
  }
  // Capture into a const so the inner closure keeps the narrowed
  // non-null type — TypeScript can't carry the narrowing through
  // function boundaries on its own.
  const tt = t

  // Helper: produce coords for a given side, clamped into the
  // viewport. Returns null when there's not enough room.
  function place(side: CalloutPlacement): { left: number; top: number } | null {
    if (side === 'bottom') {
      const top = tt.y + tt.h + GAP
      if (top + h + SAFETY > vh) return null
      const left = Math.max(SAFETY, Math.min(vw - CALLOUT_W - SAFETY, tt.x + tt.w / 2 - CALLOUT_W / 2))
      return { left, top }
    }
    if (side === 'top') {
      const top = tt.y - GAP - h
      if (top < SAFETY) return null
      const left = Math.max(SAFETY, Math.min(vw - CALLOUT_W - SAFETY, tt.x + tt.w / 2 - CALLOUT_W / 2))
      return { left, top }
    }
    if (side === 'right') {
      const left = tt.x + tt.w + GAP
      if (left + CALLOUT_W + SAFETY > vw) return null
      const top = Math.max(SAFETY, Math.min(vh - h - SAFETY, tt.y + tt.h / 2 - h / 2))
      return { left, top }
    }
    if (side === 'left') {
      const left = tt.x - GAP - CALLOUT_W
      if (left < SAFETY) return null
      const top = Math.max(SAFETY, Math.min(vh - h - SAFETY, tt.y + tt.h / 2 - h / 2))
      return { left, top }
    }
    return null
  }

  const preferred = props.placement ?? 'auto'
  const trySides: CalloutPlacement[] = preferred === 'auto'
    ? ['bottom', 'right', 'left', 'top']
    : [preferred, 'bottom', 'right', 'left', 'top']

  for (const side of trySides) {
    const out = place(side)
    if (out) return { ...out, placement: side }
  }
  // No side fits — fall back to centre with the target visible if
  // possible. Better than clipping off-viewport.
  return {
    left: Math.max(SAFETY, (vw - CALLOUT_W) / 2),
    top:  Math.max(SAFETY, (vh - h) / 2),
    placement: 'auto',
  }
}

async function syncPos() {
  await nextTick()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  pos.value = computePos()
}

function onWindowScroll() { pos.value = computePos() }
function onWindowResize() { pos.value = computePos() }

watch(() => [props.target, props.placement, props.heading], () => { void syncPos() })

onMounted(async () => {
  await syncPos()
  window.addEventListener('scroll', onWindowScroll, { capture: true, passive: true })
  window.addEventListener('resize', onWindowResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onWindowScroll, true)
  window.removeEventListener('resize', onWindowResize)
})

// Connector geometry — draws a dashed line from the callout's anchor
// edge toward the target's centre. Only rendered when a target is
// present (centred Welcome / Done callouts have no connector).
const connector = computed(() => {
  const t = getTargetRect()
  if (!t) return null
  const targetCx = t.x + t.w / 2
  const targetCy = t.y + t.h / 2
  // Anchor on the side of the callout closest to the target.
  const h = calloutHeight()
  const cx = pos.value.left + CALLOUT_W / 2
  const cy = pos.value.top + h / 2
  const dx = targetCx - cx
  const dy = targetCy - cy
  // Pick edge: dominant axis. Horizontal-dominant → anchor on the
  // left/right edge at the callout's vertical centre; vertical-
  // dominant → anchor on the top/bottom edge at the horizontal
  // centre. Single ternary per coord so CodeQL doesn't flag a dead
  // initial assignment (the previous let-then-overwrite shape had
  // both branches always rewriting the seed).
  const horizontalDominant = Math.abs(dx) > Math.abs(dy)
  const anchorX = horizontalDominant
    ? (dx > 0 ? pos.value.left + CALLOUT_W : pos.value.left)
    : pos.value.left + CALLOUT_W / 2
  const anchorY = horizontalDominant
    ? pos.value.top + h / 2
    : (dy > 0 ? pos.value.top + h : pos.value.top)
  return { x1: anchorX, y1: anchorY, x2: targetCx, y2: targetCy }
})
</script>

<template>
  <div
    ref="calloutEl"
    class="tour-callout"
    :data-placement="pos.placement"
    :style="{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${CALLOUT_W}px` }"
    role="dialog"
    aria-modal="false"
    aria-labelledby="tour-callout-heading"
  >
    <header class="tour-callout-head">
      <span class="tour-callout-eyebrow">{{ eyebrow }}</span>
      <span class="tour-callout-counter">{{ counter }}</span>
    </header>
    <div class="tour-callout-body-block">
      <div class="tour-callout-num" aria-hidden="true">
        {{ num }}
      </div>
      <h2 id="tour-callout-heading" class="tour-callout-heading">
        {{ heading }}
      </h2>
    </div>
    <p class="tour-callout-body">
      {{ body }}
    </p>
    <footer class="tour-callout-actions">
      <button
        type="button"
        class="tour-callout-skip"
        @click="emit('skip')"
      >
        Skip tour
      </button>
      <div class="tour-callout-actions-primary">
        <button
          type="button"
          class="btn ghost"
          :disabled="!canBack"
          @click="emit('back')"
        >
          Back
        </button>
        <button
          type="button"
          class="btn primary tour-callout-next"
          @click="isLast ? emit('finish') : emit('next')"
        >
          {{ isLast ? 'Done' : 'Next' }}
          <span class="tour-callout-next-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </footer>
  </div>

  <!-- Connector line from the callout toward the target's centre.
       Drawn as a full-viewport SVG so the absolute coords match the
       callout's own viewport positioning. -->
  <svg
    v-if="connector"
    class="tour-callout-connector"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <line
      :x1="connector.x1"
      :y1="connector.y1"
      :x2="connector.x2"
      :y2="connector.y2"
      stroke="var(--accent, #d96a2e)"
      stroke-width="1"
      stroke-dasharray="4 5"
      stroke-linecap="round"
      opacity="0.5"
    />
    <circle
      :cx="connector.x1"
      :cy="connector.y1"
      r="3"
      fill="var(--accent, #d96a2e)"
    />
  </svg>
</template>

<style scoped>
.tour-callout {
  position: fixed;
  z-index: 2002;
  pointer-events: auto;
  background: var(--surface, #1d1d1d);
  border: 1px solid var(--border, #3a3a3a);
  border-left: 3px solid var(--accent, #d96a2e);
  padding: 1.05rem 1.15rem 0.85rem;
  box-shadow:
    0 26px 70px rgb(0 0 0 / 60%),
    0 0 0 1px color-mix(in srgb, var(--accent, #d96a2e) 18%, transparent);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  /* Slide-in on every step change. Drives off the parent's :key
     attr on the wrapper so the animation replays. */
  animation: tour-callout-in 320ms cubic-bezier(0.18, 1, 0.32, 1) both;
  transition: left 280ms ease, top 280ms ease;
}

@keyframes tour-callout-in {
  from { opacity: 0; transform: translateY(6px) scale(0.985); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}

.tour-callout-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
}

.tour-callout-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--accent, #d96a2e);
}

.tour-callout-counter {
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.18em;
  color: var(--text-faint, #6a6a6a);
  font-feature-settings: "tnum";
}

.tour-callout-body-block {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: end;
  column-gap: 0.75rem;
  margin-top: 0.05rem;
}

.tour-callout-num {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', Impact, sans-serif;
  font-size: 3.2rem;
  line-height: 0.82;
  color: var(--accent, #d96a2e);
  /* Tilt that mirrors the masthead wordmark. Subtle — keeps
     proportions readable. */
  transform: translateY(0.06em);
}

.tour-callout-heading {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', Impact, sans-serif;
  font-weight: 400;
  font-size: 1.35rem;
  line-height: 1.05;
  color: var(--text, #f0f0f0);
  margin: 0;
  border-bottom: 2px solid var(--accent, #d96a2e);
  padding-bottom: 0.35rem;
  align-self: end;
}

.tour-callout-body {
  margin: 0;
  color: var(--text-dim, #c0c0c0);
  font-size: 0.86rem;
  line-height: 1.55;
}

.tour-callout-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.55rem;
  padding-top: 0.7rem;
  border-top: 1px dashed color-mix(in srgb, var(--text-faint, #6a6a6a) 38%, transparent);
}

.tour-callout-actions-primary {
  display: inline-flex;
  gap: 0.4rem;
}

.tour-callout-skip {
  background: transparent;
  border: 0;
  padding: 0.35rem 0.1rem;
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint, #6a6a6a);
  cursor: pointer;
}

.tour-callout-skip:hover { color: var(--text-dim, #c0c0c0); }
.tour-callout-skip:focus-visible {
  outline: 2px solid var(--accent, #d96a2e);
  outline-offset: 3px;
}

.tour-callout-next-arrow { margin-left: 0.35em; }

.tour-callout-connector {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 2001;
}

/* Centred (no-target) callout — slightly wider, no connector visible,
   skip the slide-from-side animation in favour of a pure fade-up. */
.tour-callout[data-placement='auto'] {
  width: min(440px, calc(100vw - 2 * 16px)) !important;
}

@media (prefers-reduced-motion: reduce) {
  .tour-callout {
    animation: none;
    transition: none;
  }
}
</style>
