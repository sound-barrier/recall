<script setup lang="ts">
import { ref } from 'vue'
import type { MatchRecord } from '@/api-client'
import { screenshotURL } from '@/match/match-helpers'
import { filenameFromMatchKey } from '@/match/match-key'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'

// The ambiguous-match candidate picker: the candidate list (thumb + headline +
// Attach) beside a sticky side-by-side preview pane, plus a "Treat as new match"
// escape. The active candidate (last hovered / focused) drives the pane. Emits
// `pick` with the resolved-to key — a candidate's match_key, or a freshly-minted
// match-<ts> key; the parent (UnknownMapsView) calls ResolveAmbiguousMatch.
const props = defineProps<{ rec: MatchRecord }>()
const emit = defineEmits<{ pick: [resolvedTo: string] }>()

const matchesStore = useMatchesStore()
const openLightbox = useUiStore().preview.openLightbox

// Active-candidate-per-card state — defaults to the first candidate that has a
// representative screenshot so the pane shows something on first open; updates
// on hover OR keyboard focus so keyboard-only users still drive the preview.
const active = ref<string | null>(null)
function activeCandidateKey(): string | null {
  if (active.value) return active.value
  return props.rec.candidates?.find(c => c.representative_source_file)?.match_key ?? null
}
function activeCandidate() {
  const key = activeCandidateKey()
  return key ? props.rec.candidates?.find(c => c.match_key === key) : undefined
}
function setActive(candKey: string) {
  if (active.value !== candKey) active.value = candKey
}

// Look up a candidate match by key for its hero/map/date headline; undefined when
// the candidate is no longer in `records` (hidden + show-hidden off).
function findRecord(matchKey: string): MatchRecord | undefined {
  return matchesStore.records.find(r => r.match_key === matchKey)
}

function formatDistance(seconds: number): string {
  if (seconds < 60) return `${seconds}s apart`
  return `${Math.round(seconds / 60)} min apart`
}

// "Treat as new match" mints a fresh match-<ts> key from the ambiguous
// screenshot's filename timestamp (canonical OW "...YYYY.MM.DD - HH.MM.SS.NN_*"),
// every separator `-` so the key stays URL-safe. null when no timestamp parses.
function freshKey(): string | null {
  const filename = filenameFromMatchKey(props.rec.match_key) ?? props.rec.source_files?.[0] ?? ''
  const m = /(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})\.(\d{2})/.exec(filename)
  return m ? `match-${m[1]}-${m[2]}-${m[3]}T${m[4]}-${m[5]}-${m[6]}` : null
}
</script>

<template>
  <div class="candidate-picker">
    <div class="block-eyebrow">
      Pick the match
    </div>
    <div class="candidate-picker-grid">
      <div class="candidate-list">
        <div
          v-for="cand in rec.candidates ?? []"
          :key="cand.match_key"
          class="candidate-row"
          :class="{ active: activeCandidateKey() === cand.match_key }"
          @mouseenter="setActive(cand.match_key)"
          @focusin="setActive(cand.match_key)"
        >
          <button
            v-if="cand.representative_source_file"
            type="button"
            class="candidate-thumb"
            :aria-label="`Open ${cand.match_key} screenshot in lightbox`"
            :data-candidate-thumb="cand.match_key"
            @click="openLightbox(
              cand.representative_source_file!,
              [cand.representative_source_file!],
              { [cand.representative_source_file!]: cand.representative_dir_id ?? 0 })"
          >
            <img
              :src="screenshotURL(cand.representative_source_file, cand.representative_dir_id ?? 0)"
              :alt="`Screenshot from ${cand.match_key}`"
            >
          </button>
          <div class="candidate-headline">
            <span class="candidate-key mono">{{ cand.match_key }}</span>
            <span class="candidate-distance">{{ formatDistance(cand.distance_seconds) }}</span>
            <span v-if="findRecord(cand.match_key)" class="candidate-summary">
              {{ [findRecord(cand.match_key)?.data?.map, findRecord(cand.match_key)?.data?.hero, findRecord(cand.match_key)?.data?.date].filter(Boolean).join(' · ') }}
            </span>
          </div>
          <button
            type="button"
            class="btn primary candidate-attach"
            @click="emit('pick', cand.match_key)"
          >
            Attach to this match
          </button>
        </div>
        <button
          v-if="freshKey()"
          type="button"
          class="btn ghost candidate-fresh"
          @click="emit('pick', freshKey()!)"
        >
          Treat as new match
        </button>
      </div>
      <!-- Side-by-side preview pane — the active candidate's representative
           screenshot at a comparison size; click escalates to the lightbox. -->
      <aside
        v-if="activeCandidate()?.representative_source_file"
        class="candidate-preview-pane"
        :aria-label="`Preview of ${activeCandidate()?.match_key}`"
      >
        <button
          type="button"
          class="candidate-preview-image"
          :aria-label="`Open ${activeCandidate()?.match_key} screenshot in lightbox`"
          @click="openLightbox(
            activeCandidate()!.representative_source_file!,
            [activeCandidate()!.representative_source_file!],
            { [activeCandidate()!.representative_source_file!]: activeCandidate()!.representative_dir_id ?? 0 })"
        >
          <img
            :src="screenshotURL(activeCandidate()!.representative_source_file!, activeCandidate()!.representative_dir_id ?? 0)"
            :alt="`Screenshot from ${activeCandidate()?.match_key}`"
          >
        </button>
        <div class="candidate-preview-caption mono">
          {{ activeCandidate()?.match_key }}
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.candidate-picker {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

/* 2-column layout: candidate list on the left, side-by-side preview pane on the
   right. Fixed-ish pane width so the list re-flows to fit; narrow viewports
   collapse to a single column and stack the pane under the list. */
.candidate-picker-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(220px, 32%, 360px);
  gap: 1rem;
  align-items: start;
}

.candidate-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  min-width: 0;
}

.candidate-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 3px;
  transition: border-color var(--duration-fast) ease, background var(--duration-fast) ease;
}

/* Active = the candidate the side-by-side pane is rendering. Highlighting the
   row links "what's in the pane" to "which candidate" as the user flicks down. */
.candidate-row.active {
  border-color: var(--accent);
  background: var(--surface-2);
}

/* Side-by-side preview pane. Sticky-top so it stays visible while the user
   scrolls a long candidate list; fixed 16:9 image so the slot doesn't reflow. */
.candidate-preview-pane {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  position: sticky;
  top: 0.5rem;
}

.candidate-preview-image {
  appearance: none;
  padding: 0;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 3px;
  cursor: pointer;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  transition: border-color var(--duration-fast) ease;
}

.candidate-preview-image:hover,
.candidate-preview-image:focus-visible {
  border-color: var(--accent);
  outline: none;
}

.candidate-preview-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.candidate-preview-caption {
  font-size: 0.72rem;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (width <= 720px) {
  .candidate-picker-grid {
    grid-template-columns: 1fr;
  }

  .candidate-preview-pane {
    position: static;
  }
}

/* Candidate thumbnail — 96 × 54 (16:9, OW capture aspect). Clickable: opens the
   same MatchScreenshotLightbox the in-card source-preview block uses. */
.candidate-thumb {
  appearance: none;
  flex: 0 0 auto;
  width: 96px;
  height: 54px;
  padding: 0;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: pointer;
  overflow: hidden;
  transition: border-color var(--duration-fast) ease, transform var(--duration-fast) ease;
}

.candidate-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.candidate-thumb:hover,
.candidate-thumb:focus-visible {
  border-color: var(--accent);
  outline: none;
  transform: scale(1.02);
}

.candidate-headline {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.candidate-key {
  font-size: 0.78rem;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.candidate-distance {
  font-size: 0.69rem;
  color: var(--text-faint);
}

.candidate-summary {
  font-size: 0.78rem;
  color: var(--text-dim);
}

.candidate-attach,
.candidate-fresh {
  flex-shrink: 0;
}

.candidate-fresh {
  align-self: flex-start;
  margin-top: 0.35rem;
}
</style>
