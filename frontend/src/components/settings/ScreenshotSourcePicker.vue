<script setup lang="ts">
import { computed } from 'vue'
import type { NamedCandidate, NamedCandidateStats } from '@/api'
import { useScreenshotFolderStats } from '@/composables/settings/useScreenshotFolderStats'
import { useContextualCallout } from '@/composables/shared/useContextualCallout'
import ContextualCallout from '@/components/shared/ContextualCallout.vue'

// First-run picker for the OW screenshots directory. On Windows,
// renders a 2 × 2 grid of canonical capture sources (Nvidia Overlay
// / OW PrntScn default / Snip tool / Steam install) each with a
// status dot showing whether the path exists. Clicking a found card
// emits `pick` with the path; the parent commits via
// SetScreenshotsDir + reloads. Missing cards are aria-disabled with
// a tooltip explaining the path isn't on this machine.
//
// On macOS / Linux the grid is hidden entirely (auto-detect is
// Windows-only by current product decision) and only the Pick custom
// CTA renders, prefixed with a small "Windows only" eyebrow so the
// user understands why they don't see the grid.
//
// Visual register mirrors `SettingsAppearance.vue`'s `.theme-swatch
// -row` — same role="radiogroup" + per-card `<button>`, same
// `.active` accent on hover, same display-font title + mono path.

const props = defineProps<{
  // 'windows' | 'darwin' | 'linux' | '' — we only render the grid on
  // Windows; the others get the simplified CTA. Optional so older
  // mounts that pre-date this prop fall through to the no-grid
  // branch.
  platform?: string
  // Per-source list from /api/v1/system/screenshots-folder-candidates.
  // Empty on non-Windows; on Windows it's exactly four entries.
  candidates: NamedCandidate[]
  // True while the native folder dialog is open. Disables every
  // card + the Pick custom button so a double-click can't fire two
  // dialogs.
  picking?: boolean
}>()

const emit = defineEmits<{
  // User clicked a card with `exists: true`. Parent calls
  // SetScreenshotsDir(path) and reloads.
  pick: [name: NamedCandidate['name'], path: string]
  // User clicked the "Pick a different folder…" tile. Parent
  // triggers PickScreenshotsDir (Wails native dialog or
  // window.prompt fallback).
  'pick-custom': []
}>()

const isWindows = computed(() => props.platform === 'windows')

// Side-fetched per-source diagnostics. Hydrates after mount so the
// grid renders immediately; the second metadata line appears once
// the response lands.
const { statsFor } = useScreenshotFolderStats()

// Contextual callout — fires the first time the 4-card grid
// surfaces in the wild. The four card labels alone don't make it
// obvious that each card maps to a SPECIFIC Overwatch capture
// pipeline; the callout nudges the user with one sentence so they
// don't have to guess which one their setup writes to. Auto-dismisses
// once the user picks any card (cleared inline in onCardClick) or
// on Esc / close-glyph.
const pickerCallout = useContextualCallout({
  id:   'source-picker',
  gate: () => isWindows.value && props.candidates.length > 0,
})

function onCardClick(c: NamedCandidate) {
  if (!c.exists || props.picking) return
  // Picking a card retires the hint — the user clearly knows the
  // grid's contract now.
  pickerCallout.dismiss()
  emit('pick', c.name, c.path)
}

// Compact "47 files · 2h ago" / "0 files" / "12 files · 0 recognised"
// for the second metadata line. Returns '' when no stats yet so the
// span stays empty (CSS treats it as not-rendered via :empty).
function statsLine(c: NamedCandidate): string {
  const s = statsFor(c.name)
  if (!s) return ''
  if (s.file_count === 0) return '0 files'
  const parts: string[] = [`${s.file_count} files`]
  const rel = relativeAge(s.last_modified)
  if (rel) parts.push(rel)
  // Only surface the "recognised" subset when the user is mismatched
  // — i.e. files exist but none are OW captures. Hide the noise when
  // every file is recognised (the common happy case for a correct
  // source).
  if (s.recognised_count < s.file_count) {
    parts.push(`${s.recognised_count} recognised`)
  }
  return parts.join(' · ')
}

function relativeAge(iso: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 60_000)         return 'just now'
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(t).toISOString().slice(0, 10)
}

// Expose for tests / consumers that want raw stats.
void ({} as NamedCandidateStats)
</script>

<template>
  <div class="src-picker">
    <!-- 2 × 2 grid: Windows only. Hidden on macOS / Linux. -->
    <div
      v-if="isWindows && candidates.length > 0"
      class="src-grid"
      role="radiogroup"
      aria-label="Auto-detected screenshot sources"
      data-src-grid
    >
      <button
        v-for="(c, i) in candidates"
        :key="c.name"
        type="button"
        class="src-card"
        :class="{ 'src-card-missing': !c.exists }"
        :style="{ '--card-i': i }"
        :aria-disabled="!c.exists || picking ? 'true' : undefined"
        :disabled="!c.exists || picking"
        :title="c.exists
          ? c.path
          : `This folder doesn't exist on your system. Configure your capture method to write here or pick a different folder below.\n\nWould have been: ${c.path}`"
        :data-src-name="c.name"
        @click="onCardClick(c)"
      >
        <span class="src-eyebrow">
          {{ c.name.toUpperCase() }} · {{ String(i + 1).padStart(2, '0') }}
        </span>
        <span class="src-title">{{ c.label }}</span>
        <span class="src-path">{{ c.path || '—' }}</span>
        <span
          v-if="statsLine(c)"
          class="src-stats"
          :data-src-stats="c.name"
        >{{ statsLine(c) }}</span>
        <span
          class="src-status"
          :class="c.exists ? 'src-status-found' : 'src-status-missing'"
        >
          <span aria-hidden="true" class="src-dot" />
          {{ c.exists ? 'found' : 'not found' }}
        </span>
      </button>
    </div>

    <!-- Non-Windows: short eyebrow so the user knows why the grid is
         hidden. Renders above the Pick custom button. -->
    <p
      v-if="!isWindows && platform"
      class="src-platform-note"
      data-src-platform-note
    >
      AUTO-DETECT · WINDOWS ONLY
    </p>

    <!-- Custom-pick escape. Always rendered: even on Windows the
         user may want a folder that isn't one of the four sources
         (e.g. a third-party screenshot tool). -->
    <button
      type="button"
      class="src-card-custom"
      :disabled="picking"
      data-src-pick-custom
      @click="emit('pick-custom')"
    >
      <span class="src-custom-glyph" aria-hidden="true">⤴</span>
      <span class="src-custom-label">
        <span v-if="picking">Opening picker…</span>
        <span v-else>Pick a different folder…</span>
      </span>
      <span class="src-custom-kbd" aria-hidden="true">⌘O · CTRL+O</span>
    </button>

    <!-- Just-in-time hint on the first picker render. Anchored to
         the first card so the arrow tip points at the grid; copy
         names the canonical OW capture pipelines so the user knows
         which card their setup writes to. -->
    <ContextualCallout
      v-if="pickerCallout.active()"
      target=".src-card[data-src-name]:first-child"
      heading="Each card is one capture tool"
      body="Recall recognises the four standard Overwatch screenshot pipelines — Nvidia overlay, in-game PrtSc, Snip & Sketch, and Steam. Pick the one your setup writes to; click Pick a different folder below if you use a third-party tool."
      action-label="Got it"
      @dismiss="pickerCallout.dismiss()"
      @action="pickerCallout.dismiss()"
    />
  </div>
</template>

<style scoped>
.src-picker {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 0.65rem;
}

.src-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.src-card {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--border-strong);
  border-radius: 2px;
  padding: 0.65rem 0.85rem;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  cursor: pointer;
  font: inherit;
  color: var(--text);
  transition:
    border-color var(--duration-fast),
    background var(--duration-fast),
    transform var(--duration-fast);
  animation: src-card-in 240ms ease-out both;
  animation-delay: calc(var(--card-i, 0) * 60ms);
}

@keyframes src-card-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.src-card:not(:disabled):hover,
.src-card:not(:disabled):focus-visible {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, var(--surface-2));
  outline: none;
}

.src-card-missing {
  opacity: 0.55;
  cursor: not-allowed;
}

.src-eyebrow {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.22em;
  color: var(--text-dim);
  text-transform: uppercase;
}

.src-card:not(:disabled):hover .src-eyebrow,
.src-card:not(:disabled):focus-visible .src-eyebrow {
  color: var(--accent-bright, var(--accent));
}

.src-title {
  font-family: var(--display);
  font-style: italic;
  font-size: 1.0rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--text);
  font-weight: 700;
  line-height: 1.1;
}

.src-path {
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.src-stats {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.08em;
  color: var(--text-dim);
  margin-top: 0.05rem;
}

.src-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  margin-top: 0.15rem;
}

.src-status-found  { color: var(--accent-bright, var(--accent)); }
.src-status-missing { color: var(--text-faint); }

.src-dot {
  display: inline-block;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: currentcolor;
}

.src-platform-note {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-dim);
  text-align: center;
}

.src-card-custom {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  background: transparent;
  border: 1px dashed var(--border-strong);
  border-radius: 2px;
  padding: 0.65rem 0.85rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-dim);
  cursor: pointer;
  transition:
    border-color var(--duration-fast),
    color var(--duration-fast),
    background var(--duration-fast);
}

.src-card-custom:not(:disabled):hover,
.src-card-custom:not(:disabled):focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 5%, transparent);
  outline: none;
}

.src-card-custom:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.src-custom-glyph {
  font-size: 1.0rem;
  line-height: 1;
}

.src-custom-label {
  flex: 1;
  text-align: left;
}

.src-custom-kbd {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.18em;
  color: var(--text-faint);
}

@media (prefers-reduced-motion: reduce) {
  .src-card { animation: none; }
}
</style>
