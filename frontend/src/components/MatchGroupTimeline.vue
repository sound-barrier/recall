<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { MatchGroup } from '../match-helpers'
import type { MatchRecord } from '../api'

// Right-edge vertical timeline rail. One spec-plate chip per top-level
// (month) group. Click → emit jump-to-group with the group key; the
// parent handles the expand-if-collapsed + smooth scroll. Self-tracks
// the in-view month via IntersectionObserver so the chip with the
// strongest viewport presence picks up `aria-current="location"` and
// the visual active treatment as the user scrolls.
//
// Suppressed entirely when fewer than two month groups are present —
// nothing to jump between, the rail would just be noise.

const props = defineProps<{
  groups: MatchGroup<MatchRecord>[]
}>()

const emit = defineEmits<{
  'jump-to-group': [key: string]
}>()

// Only month-level groups participate. The UNKNOWN DATE bucket is
// excluded — its records are interesting but the user doesn't navigate
// by them, and folding it into the timeline would crowd the rail with
// a non-temporal entry next to the dated months.
const monthGroups = computed(() =>
  props.groups.filter(g => g.level === 'month'),
)

// Compact label: long month name + 2-digit year (e.g. "May '26"). The
// underlying group label is the full "May 2026"; the rail is too
// narrow for that, so derive a short form from the key. Key shape is
// `month:YYYY-MM` (defined in match-helpers).
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function chipLabel(g: MatchGroup<MatchRecord>): string {
  const m = /^month:(\d{4})-(\d{2})$/.exec(g.key)
  if (!m) return g.label
  const yyyy = m[1] ?? '0000'
  const mm = Number(m[2] ?? '0')
  const monthName = MONTH_NAMES[mm - 1] ?? '???'
  return `${monthName} '${yyyy.slice(2)}`
}

// Count every match in the month subtree, walking week → day. Cached
// per chip via the computed below so we don't re-walk on every paint.
function countMatches(g: MatchGroup<MatchRecord>): number {
  let n = 0
  const visit = (node: MatchGroup<MatchRecord>) => {
    if (node.matches) n += node.matches.length
    if (node.children) for (const c of node.children) visit(c)
  }
  visit(g)
  return n
}

const monthRows = computed(() =>
  monthGroups.value.map(g => ({
    key: g.key,
    label: chipLabel(g),
    count: countMatches(g),
    // Win/loss/draw chyron on the rail is too dense to spell out;
    // surface a single win-rate ratio (W / (W+L)) since that's the
    // metric the chip count already implies.
    tally: g.tally,
  })),
)

// IntersectionObserver tracks which month's `.mg-level-month` section
// owns the largest visible area in the viewport. The chip
// corresponding to that month gets `aria-current="location"`. Falls
// back to the first month when nothing is observably in view (e.g.
// the user scrolled to a bucket above all dated months).
const activeKey = ref<string>('')

let observer: IntersectionObserver | null = null
const visibleRatios = new Map<string, number>()

// When the user clicks a chip, the scrollIntoView the parent fires
// may clamp short of putting the target in the observer's active
// band (short page / large month). Without intervention the
// observer would then re-elect whichever month IS in the band —
// usually the one above — and the rail's active marker would
// snap away from the user's pick a beat after the click. Lock the
// activeKey for a short window after each click so the chip stays
// where the user put it; user scroll afterwards releases the lock.
let clickLockUntil = 0
const CLICK_LOCK_MS = 1500

function recomputeActive() {
  if (Date.now() < clickLockUntil) return
  let bestKey = ''
  let bestRatio = 0
  for (const [key, ratio] of visibleRatios) {
    if (ratio > bestRatio) { bestRatio = ratio; bestKey = key }
  }
  if (!bestKey && monthRows.value.length > 0) bestKey = monthRows.value[0]?.key ?? ''
  activeKey.value = bestKey
}

function onUserScroll() {
  // Any genuine scroll input releases the click-lock immediately —
  // the user moved past their pick, the observer should take over.
  clickLockUntil = 0
}

function attachObserver() {
  if (typeof window === 'undefined') return
  observer?.disconnect()
  visibleRatios.clear()
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.key
        if (!key) continue
        visibleRatios.set(key, entry.isIntersecting ? entry.intersectionRatio : 0)
      }
      recomputeActive()
    },
    {
      // Slim band near the top of the viewport so the rail "snaps"
      // its active marker to whichever month occupies the user's
      // primary reading line — not whichever has the most pixels on
      // screen (a month with five expanded cards would otherwise
      // dominate over a month that's actually centred).
      rootMargin: '-20% 0px -55% 0px',
      threshold: [0, 0.25, 0.5, 0.75, 1],
    },
  )
  for (const g of monthGroups.value) {
    const el = document.querySelector(`section.mg-level-month[data-key="${CSS.escape(g.key)}"]`)
    if (el) observer.observe(el)
  }
  recomputeActive()
}

onMounted(() => {
  attachObserver()
  // wheel / touch / arrow-key scrolls release the click-lock. Passive
  // listeners — we never preventDefault, we just observe.
  window.addEventListener('wheel',    onUserScroll, { passive: true })
  window.addEventListener('touchmove', onUserScroll, { passive: true })
  window.addEventListener('keydown',  onScrollKey,  { passive: true })
})

function onScrollKey(e: KeyboardEvent) {
  // PageDown / PageUp / Home / End / ArrowDown / ArrowUp / Space all
  // scroll the document. Other keys (typing, shortcuts) don't.
  if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(e.key)) {
    onUserScroll()
  }
}

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  window.removeEventListener('wheel',     onUserScroll)
  window.removeEventListener('touchmove', onUserScroll)
  window.removeEventListener('keydown',   onScrollKey)
})

// Re-attach when the underlying month set changes (filter toggle,
// data reload). Watching the keys keeps the observer wired to the
// current DOM nodes — the previous nodes' refs go stale on a
// filter-driven re-render.
watch(
  () => monthGroups.value.map(g => g.key).join('|'),
  () => {
    // Defer to nextTick so the new sections are mounted before we
    // try to observe them.
    void Promise.resolve().then(attachObserver)
  },
)

function onChipClick(key: string) {
  // Eagerly reflect the user's pick on the rail and lock the observer
  // out for a short window. The parent's scroll may clamp short of
  // putting the target in the observer's active band, which would
  // otherwise snap the active marker away from the user's pick a
  // beat after the click. The lock releases the moment the user
  // genuinely scrolls (wheel / touch / keyboard nav keys).
  activeKey.value = key
  clickLockUntil = Date.now() + CLICK_LOCK_MS
  emit('jump-to-group', key)
}
</script>

<template>
  <nav
    v-if="monthRows.length > 1"
    class="match-timeline"
    aria-label="Match timeline"
  >
    <span class="timeline-spine" aria-hidden="true" />
    <ol class="timeline-list">
      <li
        v-for="row in monthRows"
        :key="row.key"
        class="timeline-row"
        :class="{ active: row.key === activeKey }"
      >
        <button
          type="button"
          class="timeline-chip"
          :data-key="row.key"
          :aria-current="row.key === activeKey ? 'location' : undefined"
          :title="`Jump to ${row.label} · ${row.count} match${row.count === 1 ? '' : 'es'} · ${row.tally.w}W ${row.tally.l}L${row.tally.d ? ` ${row.tally.d}D` : ''}`"
          @click="onChipClick(row.key)"
        >
          <span class="timeline-pip" aria-hidden="true" />
          <span class="timeline-chip-label">{{ row.label }}</span>
          <span class="timeline-chip-meta" aria-hidden="true">
            <span class="timeline-chip-count">{{ row.count }}</span>
          </span>
        </button>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
/* Vertical jump rail — fixed-position spec plate on the right gutter
   of the match list. Stays in place as the user scrolls so a jump
   is one click away regardless of depth. Built around a 2px accent
   spine: chips sit to the left of the spine; the spine itself
   visually anchors the timeline's "this is calendar order" reading.
   Each chip carries a pip that fills with accent when its month is
   the one currently in view, mirroring the HUD-locator vocabulary
   the rest of the app uses for active filters. */

.match-timeline {
  position: fixed;
  top: 50%;
  right: 1rem;
  transform: translateY(-50%);
  z-index: 20;
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
  max-height: 80vh;
  pointer-events: none;
}

/* Hide the rail on narrow viewports — the match list already takes
   the full width and the chip column would collide with card
   content. The 1180px floor matches the breakpoint where the filter
   grid starts to wrap. */
@media (width <= 1180px) {
  .match-timeline { display: none; }
}

.timeline-spine {
  width: 2px;
  background:
    linear-gradient(
      to bottom,
      transparent 0,
      var(--border-strong) 6%,
      var(--border-strong) 94%,
      transparent 100%
    );
  border-radius: 1px;
  pointer-events: none;
}

.timeline-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
  pointer-events: auto;
}

.timeline-list::-webkit-scrollbar { width: 4px; }
.timeline-list::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 2px; }

.timeline-row {
  display: flex;
}

.timeline-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.32rem 0.6rem 0.32rem 0.45rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    transform 200ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.timeline-chip:hover {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--surface-2);
  transform: translateX(-2px);
}

.timeline-chip:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.timeline-row.active .timeline-chip {
  color: var(--text);
  border-color: var(--accent);
  background: var(--surface-2);
  box-shadow:
    -3px 0 0 0 var(--accent),
    0 0 18px -6px var(--accent-glow);
  transform: translateX(-3px);
}

/* Pip — the leading dot in each chip. Hollow + dim by default; fills
   to accent + grows when the chip is the active month. Mirrors the
   HUD-locator pattern in the slot-chip family but tighter (4px vs 6px)
   so the chip stays compact. */
.timeline-pip {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--text-faint);
  border-radius: 50%;
  transition: background 200ms ease, border-color 200ms ease, transform 200ms cubic-bezier(0.2, 0.7, 0.3, 1.4);
}

.timeline-row.active .timeline-pip {
  background: var(--accent);
  border-color: var(--accent);
  transform: scale(1.2);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.timeline-chip-label {
  font-feature-settings: "tnum";
  white-space: nowrap;
}

.timeline-row.active .timeline-chip-label {
  color: var(--accent);
}

.timeline-chip-meta {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  padding-left: 0.45rem;
  border-left: 1px solid var(--hairline);
}

.timeline-chip-count {
  min-width: 1.4ch;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text-faint);
  text-align: right;
  font-feature-settings: "tnum";
}

.timeline-row.active .timeline-chip-count {
  color: var(--text-dim);
}

/* Reduced-motion: kill the slide-in transforms — keep only colour /
   border transitions. Pip scale still fires (it's a state-change
   confirmation; flattening it would hide the active marker shift). */
@media (prefers-reduced-motion: reduce) {
  .timeline-chip {
    transition: color 160ms ease, border-color 160ms ease, background 160ms ease;
  }

  .timeline-chip:hover,
  .timeline-row.active .timeline-chip {
    transform: none;
  }
}
</style>
