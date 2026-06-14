<script lang="ts">
import type { MatchRecord } from '@/api'

export interface ParseProgressEvent {
  done: number
  total: number
  filename: string
  screenshot_type?: string
  data?: MatchRecord['data']
  // Cumulative re-parse counters — surfaced by the Settings →
  // Advanced re-parse-all progress line as "X of Y matches updated".
  // Always 0 on a regular Parse run (no diff to count), so consumers
  // that don't read them silently ignore.
  matches_updated?: number
  hero_corrections?: number
  map_corrections?: number
}
</script>

<script setup lang="ts">
withDefaults(defineProps<{
  parseBusy: boolean
  parseProgress: ParseProgressEvent | null
  parseLog: ParseProgressEvent[]
  isOpen: boolean
  // Server-mode SSE connection state. 'reconnecting' shows a transient
  // indicator; 'lost' surfaces the manual Refresh fallback. Defaults to
  // 'connected' (no recovery UI) for Wails + callers that don't track
  // it. Union inlined (not imported from useParseRecovery) to avoid a
  // type cycle — that composable imports ParseProgressEvent from here.
  connectionState?: 'connected' | 'reconnecting' | 'lost'
}>(), {
  connectionState: 'connected',
})

defineEmits<{
  'toggle-open': []
  'refresh': []
}>()
</script>

<template>
  <div v-if="parseBusy" class="parse-progress-panel" :class="{ 'pp-open': isOpen }">
    <!-- Summary row: always visible. Click to expand/collapse details. -->
    <div class="pp-summary" @click="$emit('toggle-open')">
      <div class="pp-scan-label">
        <span class="pp-scan-dot" aria-hidden="true" />
        <span class="pp-scan-text">Parsing</span>
      </div>
      <div class="pp-bar-track">
        <div
          class="pp-bar-fill"
          :style="parseProgress && parseProgress.total
            ? { width: `${(parseProgress.done / parseProgress.total) * 100}%` }
            : { width: '0%' }"
        />
      </div>
      <div class="pp-fraction mono" :title="`${parseProgress?.done ?? 0} of ${parseProgress?.total ?? '…'} screenshot files OCR'd this run. (Each match is typically 3–4 files.)`">
        <span class="pp-done">{{ parseProgress?.done ?? 0 }}</span>
        <span class="pp-sep">&nbsp;/&nbsp;</span>
        <span class="pp-total">{{ parseProgress?.total ?? '…' }}</span>
        <span class="pp-unit">&nbsp;files</span>
      </div>
      <span class="chev pp-chev" :class="{ open: isOpen }" aria-hidden="true">›</span>
    </div>

    <!-- SSE recovery (server mode). The parse runs server-side as a
         background job, so a dropped stream doesn't stop it — we just
         lose live updates. 'reconnecting' is transient; 'lost' (the
         stream stayed down) offers a manual resync. -->
    <div
      v-if="connectionState === 'reconnecting'"
      class="pp-stream-status"
      data-stream-reconnecting
      role="status"
    >
      <span class="pp-stream-dot" aria-hidden="true" />
      <span>Reconnecting to the server…</span>
    </div>
    <div
      v-else-if="connectionState === 'lost'"
      class="pp-stream-lost"
      data-parse-stream-lost
      role="alert"
    >
      <span class="pp-stream-lost-text">Lost connection to the server. The parse may have finished.</span>
      <button
        type="button"
        class="pp-stream-refresh"
        data-parse-refresh
        @click="$emit('refresh')"
      >
        Refresh
      </button>
    </div>

    <!-- Expanded details: current file + rolling log -->
    <template v-if="isOpen">
      <!-- Current file being processed -->
      <div v-if="parseProgress" class="pp-current">
        <span class="pp-arrow" aria-hidden="true">▶</span>
        <span class="pp-cur-filename mono">{{ parseProgress.filename }}</span>
        <span
          class="pp-type-badge"
          :class="parseProgress.screenshot_type"
        >{{ parseProgress.screenshot_type?.toUpperCase() }}</span>
        <div class="pp-cur-fields">
          <template v-if="parseProgress.screenshot_type === 'summary'">
            <span v-if="parseProgress.data?.map" class="pp-field">
              <span class="pp-fl">map</span><span class="pp-fv">{{ parseProgress.data.map }}</span>
            </span>
            <span v-if="parseProgress.data?.result" class="pp-field" :class="parseProgress.data.result">
              <span class="pp-fl">result</span><span class="pp-fv">{{ parseProgress.data.result }}</span>
            </span>
            <span v-if="parseProgress.data?.date" class="pp-field">
              <span class="pp-fl">date</span><span class="pp-fv">{{ parseProgress.data.date }}</span>
            </span>
            <span v-if="parseProgress.data?.game_length" class="pp-field">
              <span class="pp-fl">length</span><span class="pp-fv">{{ parseProgress.data.game_length }}</span>
            </span>
          </template>
          <template v-else-if="parseProgress.screenshot_type === 'teams'">
            <span class="pp-field">
              <span class="pp-fl">elims</span><span class="pp-fv">{{ parseProgress.data?.eliminations ?? '—' }}</span>
            </span>
            <span class="pp-field">
              <span class="pp-fl">assists</span><span class="pp-fv">{{ parseProgress.data?.assists ?? '—' }}</span>
            </span>
            <span class="pp-field">
              <span class="pp-fl">deaths</span><span class="pp-fv">{{ parseProgress.data?.deaths ?? '—' }}</span>
            </span>
            <span v-if="parseProgress.data?.damage" class="pp-field">
              <span class="pp-fl">dmg</span><span class="pp-fv">{{ parseProgress.data.damage.toLocaleString() }}</span>
            </span>
            <span v-if="parseProgress.data?.mitigation" class="pp-field">
              <span class="pp-fl">mit</span><span class="pp-fv">{{ parseProgress.data.mitigation.toLocaleString() }}</span>
            </span>
          </template>
          <template v-else-if="parseProgress.screenshot_type === 'personal'">
            <span v-if="parseProgress.data?.hero" class="pp-field">
              <span class="pp-fl">hero</span><span class="pp-fv">{{ parseProgress.data.hero }}</span>
            </span>
            <span v-if="parseProgress.data?.heroes_played?.length" class="pp-field">
              <span class="pp-fl">played</span>
              <span class="pp-fv">{{ parseProgress.data.heroes_played.map(h => h.hero).join(' · ') }}</span>
            </span>
          </template>
          <template v-else-if="parseProgress.screenshot_type === 'rank'">
            <span v-if="parseProgress.data?.rank" class="pp-field">
              <span class="pp-fl">rank</span>
              <span class="pp-fv">{{ parseProgress.data.rank }} {{ parseProgress.data.level }}</span>
            </span>
            <span v-if="parseProgress.data?.sr?.length" class="pp-field">
              <span class="pp-fl">SR</span>
              <span class="pp-fv">{{ parseProgress.data.sr.map(s => `${s.hero} ${s.sr}`).join(' · ') }}</span>
            </span>
          </template>
        </div>
      </div>

      <!-- Rolling log of completed files -->
      <div v-if="parseLog.length > 1" class="pp-log">
        <div
          v-for="entry in [...parseLog].slice(0, -1).reverse()"
          :key="entry.done + entry.filename"
          class="pp-log-entry"
        >
          <span class="pp-log-check" aria-hidden="true">✓</span>
          <span class="pp-log-filename mono">{{ entry.filename }}</span>
          <span class="pp-log-type" :class="entry.screenshot_type">{{ entry.screenshot_type }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.parse-progress-panel {
  grid-column: 1 / -1;
  margin-top: 0.85rem;
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 3px;
  background: var(--surface-2);
  overflow: hidden;
  animation: view-fade-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.pp-summary {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 1rem;
  cursor: pointer;
  user-select: none;
  transition: background 120ms ease;
}

.pp-summary:hover { background: var(--surface-3); }

.parse-progress-panel.pp-open .pp-summary {
  border-bottom: 1px solid var(--border-soft);
}

.pp-chev {
  font-size: 1rem;
  color: var(--text-faint);
  transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1), color 120ms ease;
  flex-shrink: 0;
}

.pp-chev.open {
  transform: rotate(90deg);
  color: var(--accent-text);
}

.pp-scan-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.pp-scan-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent-glow);
  animation: pulse-dot 1.2s ease-in-out infinite;
}

.pp-scan-text {
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent-text);
  font-weight: 600;
}

.pp-bar-track {
  height: 3px;
  background: var(--surface-3);
  border-radius: 2px;
  overflow: hidden;
  min-width: 0;
}

.pp-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  box-shadow: 0 0 8px var(--accent-glow);
  transition: width 400ms cubic-bezier(0.4, 0, 0.2, 1);
}

.pp-fraction {
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-dim);
  letter-spacing: 0.03em;
  white-space: nowrap;
  font-feature-settings: "tnum";
}

.pp-done { color: var(--accent-text); font-weight: 600; }
.pp-sep  { color: var(--text-faint); }
.pp-unit { color: var(--text-faint); text-transform: lowercase; letter-spacing: 0.08em; }

/* ── SSE recovery affordances ─────────────────────────────────── */
.pp-stream-status,
.pp-stream-lost {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid var(--border-soft);
  font-size: 0.74rem;
}

.pp-stream-status {
  color: var(--text-dim);
  font-family: var(--mono);
  letter-spacing: 0.02em;
}

.pp-stream-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--draw, #d8a657);
  animation: pulse-dot 1.2s ease-in-out infinite;
  flex-shrink: 0;
}

.pp-stream-lost {
  justify-content: space-between;
  background: var(--loss-soft);
  color: var(--loss);
}

.pp-stream-lost-text { font-weight: 500; }

.pp-stream-refresh {
  appearance: none;
  border: 1px solid currentcolor;
  border-radius: 2px;
  background: transparent;
  color: inherit;
  padding: 0.3rem 0.85rem;
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
}

.pp-stream-refresh:hover { background: color-mix(in srgb, currentcolor 14%, transparent); }

.pp-current {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.35rem 0.65rem;
  padding: 0.55rem 1rem;
  border-bottom: 1px solid var(--border-soft);
}

.pp-arrow {
  font-size: 0.6rem;
  color: var(--accent);
  margin-top: 0.1rem;
  flex-shrink: 0;
  animation: pulse-dot 1s ease-in-out infinite;
}

.pp-cur-filename {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text);
  letter-spacing: 0.01em;
  flex-shrink: 0;
  max-width: 36ch;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pp-type-badge {
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 0.1rem 0.4rem;
  border-radius: 2px;
  border: 1px solid transparent;
  flex-shrink: 0;
}

.pp-type-badge.summary    { background: var(--accent-soft); border-color: var(--accent-glow); color: var(--accent-text); }
.pp-type-badge.scoreboard { background: var(--tank-soft); border-color: var(--tank); color: var(--tank); }
.pp-type-badge.personal   { background: var(--support-soft); border-color: var(--support); color: var(--support); }
.pp-type-badge.rank       { background: var(--draw-soft); border-color: var(--draw-line); color: var(--draw); }
.pp-type-badge.unknown    { background: transparent; border-color: var(--border); color: var(--text-faint); border-style: dashed; }

:global([data-theme="light"]) .pp-type-badge.scoreboard { color: var(--tank); }
:global([data-theme="light"]) .pp-type-badge.personal   { color: var(--support); }
:global([data-theme="light"]) .pp-type-badge.rank       { color: var(--draw); }

.pp-cur-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  width: 100%;
  padding-left: 1rem;
}

.pp-field {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  font-size: 0.7rem;
  font-family: var(--mono);
}

.pp-fl {
  color: var(--text-faint);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.pp-fv {
  color: var(--text);
  font-weight: 500;
}

.pp-field.victory .pp-fv { color: var(--win); }
.pp-field.defeat  .pp-fv { color: var(--loss); }
.pp-field.draw    .pp-fv { color: var(--draw); }

.pp-log {
  max-height: 140px;
  overflow-y: auto;
  padding: 0.3rem 0;
}

.pp-log-entry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.22rem 1rem;
  transition: background 120ms ease;
}

.pp-log-entry:hover { background: var(--surface-3); }

.pp-log-check {
  font-size: 0.62rem;
  color: var(--win);
  flex-shrink: 0;
  opacity: 0.7;
}

.pp-log-filename {
  font-family: var(--mono);
  font-size: 0.68rem;
  color: var(--text-dim);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pp-log-type {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.07em;
  color: var(--text-faint);
  flex-shrink: 0;
}

.pp-log-type.summary    { color: var(--accent-text); }
.pp-log-type.scoreboard { color: var(--tank); }
.pp-log-type.personal   { color: var(--support); }
.pp-log-type.rank       { color: var(--draw); }

:global([data-theme="light"]) .pp-log-type.scoreboard { color: var(--tank); }
:global([data-theme="light"]) .pp-log-type.personal   { color: var(--support); }
:global([data-theme="light"]) .pp-log-type.rank       { color: var(--draw); }
</style>
