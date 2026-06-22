<script setup lang="ts">
// Hidden-matches Archive drawer — extracted from MatchesView's set
// workspace. Collapsed by default; lists every record whose `hidden`
// flag is set, each offering Unhide + a two-step Delete-forever, plus a
// bulk action bar (select / unhide / move-to-profile / delete-forever).
//
// Selection + two-step-confirm state lives in the parent-owned
// `useArchiveSelection` composable (its onUnhide/onHardDelete callbacks
// pipe to App.vue). The shared move-to-profile picker state stays in
// MatchesView — this drawer just signals intent (begin-move /
// move-to-profile / cancel-move) and the per-row unhide / hard-delete.
import { useOWData } from '@/composables/shared/useOWData'
import type { UseArchiveSelectionApi } from '@/composables/matches/useArchiveSelection'
import { formatHeroes, formatRoles, formatRowDate, formatFinishedAt } from '@/match/match-helpers'
import { formatPlayModeLabel, formatQueueTypeLabel } from '@/match/match-label-helpers'
import ArchiveBulkBar from '@/components/matches/list/ArchiveBulkBar.vue'

const props = defineProps<{
  archive: UseArchiveSelectionApi
  // True while the shared move-to-profile picker targets the archive bar
  // (MatchesView owns the 'live' | 'archive' | null state).
  moveActive: boolean
  otherProfiles: string[]
}>()

const emit = defineEmits<{
  'unhide-match': [matchKey: string]
  'hard-delete-match': [matchKey: string]
  'begin-move': []
  'move-to-profile': [target: string]
  'cancel-move': []
}>()

const ow = useOWData()

// Refs inside a prop-passed object don't auto-unwrap; destructure to
// top-level so the template auto-unwraps them (the `narrow`-prop
// pattern from MatchesView).
const {
  archiveOpen,
  hiddenRecords,
  archiveSelectedKeys,
  archiveConfirmKey,
  toggleArchiveSelected,
  confirmHardDelete,
  cancelHardDelete,
} = props.archive
</script>

<template>
  <!-- Collapsed by default. Surfaces a count chip in the header. Body
       lists every record whose `hidden` flag is set on the parent
       props.records (which the dossier / heatmap /
       sparkline all already drop). Each row offers Unhide (returns it
       to the active set) and Delete forever (two-step affordance; second
       click hard-deletes from DB). -->
  <section
    v-if="hiddenRecords.length > 0 || archiveOpen"
    class="archive"
    aria-label="Hidden matches archive"
  >
    <button
      type="button"
      class="archive-toggle"
      :aria-expanded="archiveOpen ? 'true' : 'false'"
      aria-controls="archive-panel"
      @click="archiveOpen = !archiveOpen"
    >
      <span class="archive-eyebrow">Archive</span>
      <span class="archive-title">
        <span class="archive-count">{{ hiddenRecords.length }}</span>
        <span class="archive-noun">hidden {{ hiddenRecords.length === 1 ? 'match' : 'matches' }}</span>
      </span>
      <span class="archive-chev" :class="{ open: archiveOpen }" aria-hidden="true">▾</span>
    </button>

    <div v-if="archiveOpen" id="archive-panel" class="archive-panel">
      <p v-if="hiddenRecords.length === 0" class="archive-empty">
        Archive is empty.
      </p>

      <!-- Archive bulk action bar — appears as soon as any archive row is
           ticked (select / unhide / move-to-profile / two-step delete). -->
      <ArchiveBulkBar
        :archive="props.archive"
        :move-active="moveActive"
        :other-profiles="otherProfiles"
        @begin-move="emit('begin-move')"
        @move-to-profile="(target: string) => emit('move-to-profile', target)"
        @cancel-move="emit('cancel-move')"
      />

      <ul v-if="hiddenRecords.length > 0" class="archive-list" role="list">
        <li
          v-for="rec in hiddenRecords"
          :key="rec.match_key"
          class="archive-row"
          :class="[
            `result-${rec.data?.result || 'unknown'}`,
            { 'has-selection': archiveSelectedKeys.size > 0, 'is-ticked': archiveSelectedKeys.has(rec.match_key) },
          ]"
        >
          <button
            type="button"
            class="archive-checkbox"
            role="checkbox"
            :aria-checked="archiveSelectedKeys.has(rec.match_key) ? 'true' : 'false'"
            :aria-label="`Select hidden match ${rec.match_key}`"
            @click.stop="toggleArchiveSelected(rec.match_key)"
          >
            <span class="archive-checkbox-glyph" aria-hidden="true">{{ archiveSelectedKeys.has(rec.match_key) ? '✓' : '' }}</span>
          </button>
          <span class="archive-row-strip" aria-hidden="true" />
          <div class="archive-row-when">
            <span class="archive-row-date">{{ formatRowDate(rec) }}</span>
            <span class="archive-row-time">{{ formatFinishedAt(rec) }}</span>
          </div>
          <div class="archive-row-map">
            <span class="archive-row-map-name">{{ rec.data?.map || 'unknown' }}</span>
            <span class="archive-row-mode">{{ formatPlayModeLabel(rec) }}</span>
            <span class="archive-row-queue">{{ formatQueueTypeLabel(rec) }}</span>
          </div>
          <div class="archive-row-hero">
            <span class="archive-row-hero-name">{{ formatHeroes(rec) }}</span>
            <span v-if="formatRoles(rec, ow.heroRole)" class="archive-row-role">{{ formatRoles(rec, ow.heroRole) }}</span>
          </div>
          <div class="archive-row-stats">
            <span class="archive-row-stat">{{ rec.data?.eliminations ?? '—' }}</span>
            <span class="archive-row-sep" aria-hidden="true">/</span>
            <span class="archive-row-stat">{{ rec.data?.assists ?? '—' }}</span>
            <span class="archive-row-sep" aria-hidden="true">/</span>
            <span class="archive-row-stat archive-row-stat-deaths">{{ rec.data?.deaths ?? '—' }}</span>
          </div>
          <div class="archive-row-actions">
            <template v-if="archiveConfirmKey !== rec.match_key">
              <button
                type="button"
                class="archive-unhide"
                @click="emit('unhide-match', rec.match_key)"
              >
                Unhide
              </button>
              <button
                type="button"
                class="archive-delete"
                @click="confirmHardDelete(rec.match_key)"
              >
                Delete forever
              </button>
            </template>
            <template v-else>
              <span class="archive-confirm-pre" aria-hidden="true">⚠</span>
              <button
                type="button"
                class="archive-confirm"
                @click="emit('hard-delete-match', rec.match_key)"
              >
                Confirm
              </button>
              <button
                type="button"
                class="archive-cancel"
                @click="cancelHardDelete"
              >
                Cancel
              </button>
            </template>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
/* The .archive-checkbox base + ticked/glyph styling is shared with the
   live leaf row, so it lives in app.css (one place, both components). */

.archive-row.is-ticked {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  outline: 1px solid var(--accent);
  opacity: 1;
}

/* ─── Hidden drawer (Archive) ──────────────────────────────── */

.archive {
  margin-top: 0.4rem;
  border: 1px dashed color-mix(in srgb, var(--border) 80%, transparent);
  background:
    repeating-linear-gradient(
      45deg,
      color-mix(in srgb, var(--text-dim) 3%, transparent) 0,
      color-mix(in srgb, var(--text-dim) 3%, transparent) 8px,
      transparent 8px,
      transparent 16px
    ),
    var(--surface);
  border-radius: 2px;
  overflow: hidden;
}

.archive-toggle {
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: 0.7rem;
  padding: 0.6rem 0.85rem;
  appearance: none;
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: left;
}
.archive-toggle:hover { background: color-mix(in srgb, var(--text-dim) 5%, transparent); }

.archive-eyebrow {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
}
.archive-title { display: inline-flex; align-items: baseline; gap: 0.5rem; }

.archive-count {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 1.15rem;
  color: var(--text);
  line-height: 1;
}

.archive-noun {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.archive-chev {
  margin-left: auto;
  color: var(--text-dim);
  font-size: 0.9rem;
  transform: rotate(-90deg);
  transition: transform 120ms ease;
}
.archive-chev.open { transform: rotate(0deg); }

.archive-panel {
  border-top: 1px dashed color-mix(in srgb, var(--border) 80%, transparent);
  padding: 0.55rem 0.7rem 0.7rem;
}

.archive-empty {
  margin: 0;
  text-align: center;
  font-family: var(--mono);
  color: var(--text-dim);
  font-size: 0.7rem;
  padding: 0.7rem 0;
}

.archive-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.archive-row {
  display: grid;
  grid-template-columns:
    1.1rem        /* checkbox — reserved, opacity-driven */
    6px           /* result strip */
    minmax(64px, auto) /* date/time */
    minmax(140px, 1fr) /* map */
    minmax(140px, 1fr) /* hero */
    minmax(110px, auto) /* stats */
    auto;         /* actions */

  align-items: center;
  gap: 0.55rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  border-radius: 2px;
  background: color-mix(in srgb, var(--surface-2) 70%, transparent);

  /* dimmed treatment — archived feel without losing legibility */
  opacity: 0.78;
}
.archive-row:hover { opacity: 0.96; }

.archive-row-strip {
  width: 4px;
  height: 1.6rem;
  background: var(--text-faint);
  border-radius: 1px;
}
.archive-row.result-victory .archive-row-strip { background: var(--win); }
.archive-row.result-defeat  .archive-row-strip { background: var(--loss); }
.archive-row.result-draw    .archive-row-strip { background: var(--accent); }

.archive-row-when {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-dim);
}
.archive-row-date { color: var(--text); font-weight: 700; letter-spacing: 0.04em; }
.archive-row-time { color: var(--text-faint); }
.archive-row-map { display: flex; flex-direction: column; gap: 0.05rem; min-width: 0; }

.archive-row-map-name {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 0.95rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-row-mode,
.archive-row-queue {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.archive-row-queue { margin-left: 0.4rem; }
.archive-row-hero { display: flex; flex-direction: column; gap: 0.05rem; min-width: 0; }

.archive-row-hero-name {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 0.92rem;
  text-transform: uppercase;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-row-role {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.archive-row-stats {
  display: inline-flex;
  align-items: baseline;
  gap: 0.2rem;
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  color: var(--text);
}
.archive-row-stat { font-size: 0.95rem; letter-spacing: 0.02em; }
.archive-row-stat-deaths { color: var(--text-dim); }
.archive-row-sep { color: var(--text-faint); font-size: 0.8rem; }

.archive-row-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
}

.archive-row-actions button {
  appearance: none;
  border-radius: 2px;
  padding: 0.3rem 0.6rem;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  cursor: pointer;
  line-height: 1;
}

.archive-unhide {
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
}
.archive-unhide:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }

.archive-delete {
  border: 1px solid color-mix(in srgb, var(--loss) 70%, var(--border));
  background: transparent;
  color: var(--loss);
}
.archive-delete:hover { background: color-mix(in srgb, var(--loss) 12%, transparent); }

.archive-confirm-pre {
  color: var(--loss);
  font-size: 0.95rem;
  line-height: 1;
  padding-right: 0.1rem;
}

.archive-confirm {
  border: 1px solid var(--loss);
  background: var(--loss);
  color: var(--primary-text-on-accent, #111);
}
.archive-confirm:hover { filter: brightness(1.06); }

.archive-cancel {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
}
.archive-cancel:hover { color: var(--text); border-color: var(--text); }
</style>
