<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { ParseProgressEvent } from './ParseProgressPanel.vue'
import SupportedSourcesRow from './SupportedSourcesRow.vue'

// Advanced collapsible at the bottom of Settings — Grafana streaming
// toggle + destructive Clear Database flow + Manage ignored files
// (the Unknown-tab "Delete forever" recovery surface). Native
// <details> gives free keyboard support; the styled <summary> mirrors
// a section header for visual continuity.
//
// Extracted from SettingsView so the section-specific styles
// (.advanced-*, .big-switch) live with the component that owns the
// markup. The destructive-row styles (`.setting-row.danger-row` +
// `.clear-confirm-group`) stay in SettingsView because they're
// shared with the Backup/Restore section's Import-arm flow.

const props = defineProps<{
  prometheusEnabled: boolean
  clearingDB?:       boolean
  clearConfirm?:     boolean
  matchedCount?:     number
  unknownCount?:     number
  // Count of files in the Unknown-tab "Delete forever" suppress list.
  // 0 hides the keep-suppress-list checkbox in the Clear arm step and
  // disables the Manage button.
  ignoredCount?:     number
  // True while a Re-parse-all run is in flight (parse-progress SSE
  // events streaming). Driven by the parent's parseProgress state
  // machine — same source the masthead's parse indicator reads.
  reparsing?:        boolean
  // Latest parse-progress event — drives the re-parse running-count
  // line beneath the button ("X of Y matches updated · N hero / M
  // map corrected"). Null when no parse is in flight.
  parseProgress?:    ParseProgressEvent | null
}>()

const emit = defineEmits<{
  'toggle-prometheus':  []
  'arm-clear':          []
  'cancel-clear':       []
  'clear-database':     [opts: { keepIgnored: boolean }]
  'open-ignored-panel': []
  // Two-step arm/disarm fires this once on confirm. App.vue calls
  // api.ts ReParseAll() which POSTs /api/v1/parses?scope=all and
  // streams parse-progress events. The progress panel surfaces
  // per-file activity through its existing SSE wiring.
  're-parse-all':       []
}>()

// Re-parse running counts — surfaced beneath the button while a
// re-parse-all run is in flight, then held visible for 5 s after
// completion so the user reads the result before it clears. Pulled
// from props.parseProgress directly so the test can mount with the
// prop set and see the line render immediately (a watch wouldn't
// fire on initial render).
const lastReparseSummary = ref<{ updated: number; hero: number; map: number; total: number } | null>(null)
let reparseClearTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.parseProgress, (next) => {
  if (next && (next.matches_updated || next.hero_corrections || next.map_corrections)) {
    lastReparseSummary.value = {
      updated: next.matches_updated ?? 0,
      hero:    next.hero_corrections ?? 0,
      map:     next.map_corrections ?? 0,
      total:   next.total ?? 0,
    }
  }
}, { immediate: true })

watch(() => props.reparsing, (next, prev) => {
  // Transition true → false signals the run finished — hold the
  // visible summary for 5 s, then clear so the row's clean.
  if (prev && !next) {
    if (reparseClearTimer) clearTimeout(reparseClearTimer)
    reparseClearTimer = setTimeout(() => {
      lastReparseSummary.value = null
      reparseClearTimer = null
    }, 5000)
  }
})

const reparseProgressLine = computed(() => {
  const s = lastReparseSummary.value
  if (!s) return ''
  const parts = [
    `${s.updated} of ${s.total} matches updated`,
  ]
  const fixes: string[] = []
  if (s.hero > 0) fixes.push(`${s.hero} hero`)
  if (s.map  > 0) fixes.push(`${s.map} map`)
  if (fixes.length > 0) parts.push(`${fixes.join(' / ')} corrected`)
  return parts.join(' · ')
})

// Local arm/disarm state for the destructive "Re-parse all"
// affordance — mirrors the Clear DB pattern but lives here because
// the lifecycle is shorter (single-shot, no extra opt-out
// checkbox). Auto-disarm after 6 s so a stale arm doesn't fire on
// an accidental click an hour later.
const reparseConfirm = ref(false)
let reparseDisarmTimer: ReturnType<typeof setTimeout> | null = null
function armReparse() {
  reparseConfirm.value = true
  if (reparseDisarmTimer) clearTimeout(reparseDisarmTimer)
  reparseDisarmTimer = setTimeout(() => { reparseConfirm.value = false }, 6000)
}
function cancelReparse() {
  reparseConfirm.value = false
  if (reparseDisarmTimer) {
    clearTimeout(reparseDisarmTimer)
    reparseDisarmTimer = null
  }
}
function confirmReparse() {
  cancelReparse()
  emit('re-parse-all')
}

// Opt-out checkbox state. Default false so the Clear arm's "factory
// reset" semantic wins by default; the user has to actively opt into
// keeping the suppress list. Resets to false every time the arm
// re-opens so an old toggle doesn't sneak through.
const keepIgnoredOnClear = ref(false)
watch(
  () => props.clearConfirm,
  (next, prev) => {
    if (next && !prev) keepIgnoredOnClear.value = false
  },
)
</script>

<template>
  <details id="sec-advanced" class="settings-section advanced-section">
    <summary class="advanced-summary">
      <span class="section-num">07</span>
      <span class="section-slash" aria-hidden="true">/</span>
      <span class="section-title">Advanced</span>
      <span class="advanced-chev" aria-hidden="true">›</span>
    </summary>
    <div class="setting-rows advanced-rows">
      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            Stream to Grafana
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About Grafana streaming</span>
              <span class="setting-help-pop" role="tooltip">
                Exposes Prometheus metrics on <code>localhost:9091/metrics</code> so the bundled Grafana dashboard can chart your trends. Requires the docker-compose stack to be running locally.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Expose match history on <code>localhost:9091/metrics</code> so the bundled Prometheus container can scrape it. Off by default — no port is opened until you enable this.
          </p>
        </div>
        <div class="setting-control">
          <label class="big-switch" :class="{ on: prometheusEnabled }">
            <input type="checkbox" :checked="prometheusEnabled" @change="emit('toggle-prometheus')">
            <span class="big-switch-track"><span class="big-switch-knob" /></span>
            <span class="big-switch-state">{{ prometheusEnabled ? 'Live' : 'Off' }}</span>
          </label>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            Manage ignored screenshots
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About ignored screenshots</span>
              <span class="setting-help-pop" role="tooltip">
                "Delete forever" on the Unknown tab adds a file to this list. Files on the list are skipped on every future Parse run. Open the panel to bring them back.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            <template v-if="(ignoredCount ?? 0) === 0">
              You haven't deleted any screenshots forever yet. Files you mark on the Unknown tab will land here so you can recover them.
            </template>
            <template v-else>
              {{ ignoredCount }} file{{ (ignoredCount ?? 0) === 1 ? '' : 's' }} currently skipped on every Parse run. Open the panel to restore them — the next Parse run will re-discover them from disk.
            </template>
          </p>
        </div>
        <div class="setting-control">
          <button
            class="btn"
            :disabled="(ignoredCount ?? 0) === 0"
            @click="emit('open-ignored-panel')"
          >
            Manage…
          </button>
        </div>
      </div>

      <div class="setting-row" :class="{ 'danger-row': reparseConfirm }">
        <div class="setting-info">
          <h4 class="setting-label">
            Re-parse All Screenshots
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About Re-parse All</span>
              <span class="setting-help-pop" role="tooltip">
                Re-runs OCR on every screenshot. Use after a release tightens the parser or adds a hero/map to the canonical roster. Your annotations, queue + play-mode overrides, hidden flags, and reviews all survive — they key on match_key.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Re-runs Tesseract on every PNG in the watched folder. Use after a Recall release that tightens hero/map matching (e.g. the Miyazaki-misattribution fix) to retroactively correct older records. Estimated time: ~1 second per screenshot.
          </p>
        </div>
        <div class="setting-control">
          <template v-if="!reparseConfirm">
            <button
              class="btn"
              :disabled="reparsing"
              data-reparse-all-arm
              @click="armReparse"
            >
              <span v-if="reparsing">Re-parsing…</span>
              <span v-else>Re-parse all…</span>
            </button>
          </template>
          <template v-else>
            <div class="clear-confirm-group">
              <button
                class="btn danger"
                :disabled="reparsing"
                data-reparse-all-confirm
                @click="confirmReparse"
              >
                Confirm re-parse
              </button>
              <button class="btn ghost" :disabled="reparsing" @click="cancelReparse">
                Cancel
              </button>
            </div>
          </template>
          <p
            v-if="reparseProgressLine"
            class="reparse-progress-line"
            data-reparse-progress-line
          >
            {{ reparseProgressLine }}
          </p>
        </div>
      </div>

      <SupportedSourcesRow />

      <div class="setting-row" :class="{ 'danger-row': clearConfirm }">
        <div class="setting-info">
          <h4 class="setting-label">
            Clear Parse Database
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About Clear Database</span>
              <span class="setting-help-pop" role="tooltip">
                Wipes every parsed match. Settings and screenshots stay; you can re-parse to rebuild. Two-step arm/confirm prevents accidental data loss.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Permanently delete all {{ (matchedCount ?? 0) + (unknownCount ?? 0) }} parsed match record{{ ((matchedCount ?? 0) + (unknownCount ?? 0)) === 1 ? '' : 's' }} from the local database. Settings and screenshots are untouched — you can re-parse at any time to rebuild from scratch.
          </p>
          <p v-if="clearConfirm" class="setting-meta blocked">
            <span class="block-mark" aria-hidden="true">⚠</span>
            This cannot be undone.
          </p>
          <label
            v-if="clearConfirm && (ignoredCount ?? 0) > 0"
            class="clear-keep-ignored"
          >
            <input
              v-model="keepIgnoredOnClear"
              type="checkbox"
            >
            Keep the {{ ignoredCount }} ignored screenshot{{ ignoredCount === 1 ? '' : 's' }} so I don't have to re-triage them.
          </label>
        </div>
        <div class="setting-control">
          <template v-if="!clearConfirm">
            <button
              class="btn danger-outline"
              :disabled="clearingDB || ((matchedCount ?? 0) + (unknownCount ?? 0)) === 0"
              @click="emit('arm-clear')"
            >
              Clear Database…
            </button>
          </template>
          <template v-else>
            <div class="clear-confirm-group">
              <button
                class="btn danger"
                :disabled="clearingDB"
                @click="emit('clear-database', { keepIgnored: keepIgnoredOnClear })"
              >
                <span v-if="clearingDB">Deleting…</span>
                <span v-else>Delete {{ (matchedCount ?? 0) + (unknownCount ?? 0) }} Record{{ ((matchedCount ?? 0) + (unknownCount ?? 0)) === 1 ? '' : 's' }}</span>
              </button>
              <button class="btn ghost" :disabled="clearingDB" @click="emit('cancel-clear')">
                Cancel
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
.advanced-section {
  margin-top: 2.6rem;
}

/* Strip native disclosure triangle — replaced by our own ›. */
.advanced-section > summary {
  list-style: none;
}

.advanced-section > summary::-webkit-details-marker {
  display: none;
}

.advanced-summary {
  display: flex;
  align-items: baseline;
  gap: 0.7rem;
  padding-bottom: 0.85rem;
  margin-bottom: 0.4rem;
  border-bottom: 1px solid var(--brand-gray);
  cursor: pointer;
  position: relative;
  user-select: none;
  transition: border-color 160ms ease;
}

.advanced-summary:hover {
  border-color: var(--border-strong);
}

.advanced-summary:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 2px 0 var(--accent);
}

.advanced-summary::after {
  /* Same orange tick as `.section-header` — visual continuity. The
     light-mode override (rust + no glow) lives in app.css as a
     properly-scoped global rule. */
  content: '';
  position: absolute;
  right: 0;
  bottom: -1px;
  width: 28px;
  height: 3px;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent-glow);
}

.advanced-summary .section-num,
.advanced-summary .section-title {
  /* Reuse the global section-header typography directly. */
  transform: translateY(2px);
}

.advanced-chev {
  margin-left: auto;
  font-family: var(--display);
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--text-faint);
  line-height: 1;
  transition: transform 200ms ease, color 200ms ease;
}

.advanced-section[open] .advanced-chev {
  transform: rotate(90deg);
  color: var(--accent);
}

.advanced-rows {
  /* Subtle fade-in when the user expands. Reduced-motion clobbers it
     via the @media block at the bottom of SettingsView's \3c style>. */
  animation: advanced-reveal 240ms ease;
}

@keyframes advanced-reveal {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ─── Big-switch (Grafana toggle) ────────────────────────── */

.big-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.85rem;
  cursor: pointer;
  user-select: none;
}

.big-switch input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.big-switch-track {
  position: relative;
  width: 56px;
  height: 30px;
  background: var(--surface-3);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  transition: background 240ms ease, border-color 240ms ease, box-shadow 240ms ease;
}

.big-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 24px;
  height: 24px;
  background: var(--text-faint);
  border-radius: 50%;
  transition:
    transform 260ms cubic-bezier(0.4, 0, 0.2, 1),
    background 240ms ease,
    box-shadow 240ms ease;
}

.big-switch.on .big-switch-track {
  background: var(--accent-soft);
  border-color: var(--accent);
  box-shadow: 0 0 18px -2px var(--accent-glow);
}

.big-switch.on .big-switch-track .big-switch-knob {
  background: var(--accent);
  box-shadow: 0 0 14px var(--accent-glow);
  transform: translateX(26px);
}

.big-switch-state {
  min-width: 3.6rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--text-faint);
  transition: color 220ms ease;
}

.big-switch.on .big-switch-state {
  color: var(--accent);
}

.big-switch:focus-within .big-switch-track {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-soft), 0 0 18px -2px var(--accent-glow);
}

/* "Keep suppress-list" opt-out checkbox — sits inside the Clear-arm
   info column. Hidden when the suppress-list is empty so the
   destructive flow doesn't ask the user about something that doesn't
   apply. */
.clear-keep-ignored {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-top: 0.55rem;
  font-size: 0.85rem;
  color: var(--text-dim);
  cursor: pointer;
  line-height: 1.4;
}

.clear-keep-ignored input[type="checkbox"] {
  margin-top: 0.18rem;
  flex-shrink: 0;
  accent-color: var(--accent);
}

</style>
