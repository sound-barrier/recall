<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

import {
  spotlightRectFor,
  bracketLength,
  cornerBracketPaths,
} from '@/components/shared/tour-spotlight-helpers'

// Spotlight overlay. Renders a full-viewport SVG with a dim rect over
// the entire screen and a cutout window where the target lives.
// Corner brackets (viewfinder/reticle style) draw attention without
// obscuring the target.
//
// Layout strategy:
//   1. position: fixed; inset: 0; pointer-events: none.
//   2. SVG fills the viewport in user coordinates so the cutout can
//      be expressed as a single <rect> with rx/ry rounded corners,
//      and the bracket strokes overlay at the same coordinates.
//   3. A ResizeObserver tracks the target's size and a `scroll`
//      listener (capture, passive) tracks its viewport-relative
//      position. Both flush into the same `targetRect` ref. The svg
//      transition (CSS) animates between rects on tween-style step
//      changes so the spotlight glides rather than jumping.
//   4. When `target` is null OR the selector resolves to nothing, the
//      cutout collapses to zero size and the dim covers the whole
//      viewport — used for Welcome / Done steps that render a
//      centered briefing instead.
//
// Hit-testing: the SVG overlay carries `pointer-events: none`. The
// cutout is purely visual — the tour does NOT pass clicks through.
// That keeps the user's clicks on real UI buttons that exist UNDER
// the dim until they explicitly choose Next / Back. (If a future
// iteration wants click-through-the-cutout, a transparent proxy
// overlay sized to the target rect can opt-in.)

const props = defineProps<{
  // CSS selector to spotlight. null = no spotlight (cover the whole
  // screen). String must resolve to a single element. If the
  // selector matches multiple elements, the FIRST is chosen
  // (matches Playwright's `.first()` semantics).
  target: string | null | undefined
  // Padding in CSS px the cutout extends BEYOND the target's
  // bounding rect. Gives the target a visual breathing room and
  // keeps the corner brackets clear of the target's own edges.
  padding?: number
  // Cutout corner radius.
  radius?: number
}>()

const padding = computed(() => props.padding ?? 8)
const radius  = computed(() => props.radius ?? 4)

// Viewport-relative rect of the spotlight cutout. Width/height of 0
// collapses the cutout (Welcome / Done steps).
const rect = ref({ x: 0, y: 0, w: 0, h: 0 })

// The currently-tracked element. ResizeObserver and the scroll
// listener key off this ref so subsequent target changes detach
// from the previous element cleanly.
const tracked = ref<HTMLElement | null>(null)
let observer: ResizeObserver | null = null
// syncTarget parks on a frame and a smooth-scroll timer before it
// attaches anything. Closing the tour mid-step lands the teardown in
// that window, so every resumption point re-checks this — otherwise the
// resumed pass scrolls the page for a tour that is gone and attaches a
// ResizeObserver onBeforeUnmount has already run past.
let disposed = false

function recompute() {
  const el = tracked.value
  rect.value = spotlightRectFor(el ? el.getBoundingClientRect() : null, padding.value)
}

function resolveTarget(): HTMLElement | null {
  if (!props.target) return null
  try {
    const el = document.querySelector(props.target)
    return el instanceof HTMLElement ? el : null
  } catch (_) {
    // Invalid selector — treat as no target.
    return null
  }
}

async function syncTarget() {
  // Wait a tick so any view switch that happened in the SAME watch
  // has rendered its target element to the DOM.
  await nextTick()
  // And one more frame for layout to settle (CSS transitions on the
  // tab panel still mid-flight otherwise).
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  if (disposed) return
  const el = resolveTarget()
  if (observer) observer.disconnect()
  tracked.value = el
  if (el) {
    // Scroll the target into view first — many tour stops point at
    // sections that live below the fold on shorter viewports (the
    // Settings → Folders block is ~300px tall and lives after the
    // empty-hero on first launch). `block: 'center'` keeps the
    // target away from the very top of the screen so the callout
    // has room to anchor above OR below it.
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
    // Wait for the smooth scroll to settle so getBoundingClientRect
    // returns the post-scroll coords. Two frames is enough for the
    // smooth-scroll easing to complete in modern browsers when the
    // distance is small; long scrolls still land within the
    // ResizeObserver / scroll listener's recompute cycle.
    await new Promise<void>(resolve => setTimeout(resolve, 320))
    if (disposed) return
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(recompute)
      observer.observe(el)
    }
  }
  recompute()
}

function onWindowScroll() { recompute() }
function onWindowResize() { recompute() }

watch(() => props.target, () => { void syncTarget() })

onMounted(async () => {
  await syncTarget()
  // Capture-phase scroll listener so nested scrollers (the detail
  // panel body, the matches list) still drive the recompute. Passive
  // because we never preventDefault on scroll.
  window.addEventListener('scroll', onWindowScroll, { capture: true, passive: true })
  window.addEventListener('resize', onWindowResize)
})

onBeforeUnmount(() => {
  disposed = true
  if (observer) observer.disconnect()
  window.removeEventListener('scroll', onWindowScroll, true)
  window.removeEventListener('resize', onWindowResize)
})

// Corner bracket geometry — four L-shaped paths anchored to the cutout
// corners, sized proportionally to the cutout's shorter side. The math
// lives in tour-spotlight-helpers so it is testable without a layout
// engine; this only feeds it the live rect.
const brackets = computed(() => cornerBracketPaths(rect.value, bracketLength(rect.value)))

// Computed mask id used to punch out the cutout. Includes a step
// hash so two spotlights side-by-side would each have their own
// mask if needed.
const maskId = 'tour-spotlight-mask'

// The visual transition between two targets feels best when the
// cutout glides on its own thread — CSS handles that via `transition`
// on the rect's x/y/width/height attrs. SVG attribute transitions are
// supported in all modern browsers we ship to.
const cutoutVisible = computed(() => rect.value.w > 0 && rect.value.h > 0)
</script>

<template>
  <svg
    class="tour-spotlight"
    :class="{ 'tour-spotlight-no-cutout': !cutoutVisible }"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    preserveAspectRatio="xMidYMid slice"
  >
    <defs>
      <mask :id="maskId">
        <!-- White = visible (the dim layer). Black = hole. -->
        <rect width="100%" height="100%" fill="white" />
        <rect
          v-if="cutoutVisible"
          :x="rect.x"
          :y="rect.y"
          :width="rect.w"
          :height="rect.h"
          :rx="radius"
          :ry="radius"
          fill="black"
          class="tour-spotlight-cutout"
        />
      </mask>
    </defs>
    <rect
      class="tour-spotlight-dim"
      width="100%"
      height="100%"
      :mask="`url(#${maskId})`"
    />
    <!-- Viewfinder corner brackets — only drawn when there's a real
         cutout to anchor to. -->
    <g v-if="cutoutVisible" class="tour-spotlight-brackets">
      <path
        v-for="bracket in brackets"
        :key="bracket.corner"
        :d="bracket.d"
      />
    </g>
    <!-- Hairline outline around the cutout — sits between the
         brackets, completes the viewfinder gestalt. -->
    <rect
      v-if="cutoutVisible"
      class="tour-spotlight-outline"
      :x="rect.x"
      :y="rect.y"
      :width="rect.w"
      :height="rect.h"
      :rx="radius"
      :ry="radius"
      fill="none"
    />
  </svg>
</template>

<style scoped>
.tour-spotlight {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;

  /* z-index sits ABOVE the detail panel + the lightbox so the cutout
     can spotlight elements inside either. The tour callout uses
     z-index: 2001 to layer above the spotlight. */
  z-index: 2000;
  pointer-events: none;

  /* SVG transitions between two targets ride the same easing as the
     callout slide. */
}

.tour-spotlight-dim {
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value --
     the spotlight scrim: everything outside the cutout. Same rule as a
     modal scrim in tokens.css — it dims the app in every theme and is
     deliberately black, and a themed fill would wash out the cutout. */
  fill: rgb(0 0 0 / 78%);
}

.tour-spotlight-outline {
  stroke: var(--accent);
  stroke-width: 1.5;
  opacity: 0.55;
  transition: x var(--duration-slow) ease, y var(--duration-slow) ease, width var(--duration-slow) ease, height var(--duration-slow) ease;
}

.tour-spotlight-cutout {
  transition: x var(--duration-slow) ease, y var(--duration-slow) ease, width var(--duration-slow) ease, height var(--duration-slow) ease;
}

.tour-spotlight-brackets {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;

  /* Subtle pulse to draw the eye to the target. The brackets are
     SVG paths so we animate opacity rather than transform for crisp
     anti-aliasing through the cycle. */
  animation: tour-bracket-pulse 2.6s ease-in-out infinite;
}

@keyframes tour-bracket-pulse {
  0%, 100% { opacity: 0.85; }
  50%      { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .tour-spotlight-outline,
  .tour-spotlight-cutout {
    transition: none;
  }

  .tour-spotlight-brackets {
    animation: none;
    opacity: 1;
  }
}
</style>
