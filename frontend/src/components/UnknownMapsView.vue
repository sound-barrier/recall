<script setup lang="ts">
import type { MatchRecord } from '../api'
import { detectScreenshotSlots, screenshotURL, formatParsedAt } from '../match-helpers'
import type { CardStateApi } from './MatchesView.vue'

// UnknownMapsView is the triage tab for records that lack a map (the
// most common pre-flight failure: a corrupted SUMMARY/TEAMS screenshot,
// or a non-OW PNG in the watched folder). Per-card UI state is shared
// with MatchesView via the CardStateApi bundle, so the user's expand
// choices for a record carry across tabs.

defineProps<{
  unknownRecords: MatchRecord[]
  cardState:      CardStateApi
}>()

const emit = defineEmits<{
  'go-to-view': [next: 'settings' | 'ingest' | 'matches' | 'unknown']
}>()
</script>

<template>
  <section id="panel-unknown" role="tabpanel" aria-labelledby="tab-unknown" tabindex="-1" class="settings unknown-view">
    <header class="settings-intro">
      <p class="settings-eyebrow">
        Diagnostic Review
      </p>
      <h2 v-if="unknownRecords.length === 0" class="settings-heading">
        All screenshots resolved.
      </h2>
      <h2 v-else class="settings-heading unknown-heading">
        <em>{{ unknownRecords.length }} record{{ unknownRecords.length === 1 ? '' : 's' }}</em>
        couldn't be matched to a map.
      </h2>
      <p v-if="unknownRecords.length > 0" class="unknown-desc">
        The slot indicators below show which screenshot types have been parsed for each record. Add the missing ones and
        <button type="button" class="empty-link" @click="emit('go-to-view', 'ingest')">
          run Parse
        </button>
        again to resolve them.
      </p>
    </header>

    <div v-if="unknownRecords.length === 0" class="empty">
      <div class="empty-mark">
        ◉
      </div>
      <p class="empty-title">
        No unresolved records.
      </p>
      <p class="empty-sub">
        Every parsed match has a map name — you're clean.
      </p>
    </div>

    <div v-else class="unknown-list">
      <article
        v-for="(rec, idx) in unknownRecords"
        :key="rec.match_key"
        class="unknown-card"
        :class="{ expanded: cardState.isSelected(rec.match_key) }"
      >
        <!-- Card header: index + match key + slot chips + chevron -->
        <div class="unknown-card-head" @click="cardState.toggleExpand(rec.match_key)">
          <div class="unknown-head-lhs">
            <span class="unknown-idx">{{ String(idx + 1).padStart(2, '0') }}</span>
            <div class="unknown-key-block">
              <span class="unknown-key mono">{{ rec.match_key }}</span>
              <span class="unknown-src-count">{{ rec.source_files?.length || 0 }} screenshot{{ (rec.source_files?.length || 0) === 1 ? '' : 's' }}</span>
            </div>
          </div>
          <div class="unknown-head-rhs">
            <div class="slot-row" @click.stop>
              <span
                v-for="slot in detectScreenshotSlots(rec)"
                :key="slot.key"
                class="slot-chip"
                :class="{ present: slot.present, absent: !slot.present }"
                :title="slot.hint"
              >
                <span class="slot-dot" aria-hidden="true" />
                {{ slot.label }}
              </span>
            </div>
            <span class="chev" :class="{ open: cardState.isSelected(rec.match_key) }" aria-hidden="true">›</span>
          </div>
        </div>

        <!-- Field diagnostic strip — always visible -->
        <div class="unknown-fields">
          <div
            v-for="fd in [
              { label: 'Map', value: rec.data?.map },
              { label: 'Mode', value: rec.data?.mode },
              { label: 'Type', value: rec.data?.type },
              { label: 'Result', value: rec.data?.result },
              { label: 'Date', value: rec.data?.date },
              { label: 'Time', value: rec.data?.finished_at },
              { label: 'Length', value: rec.data?.game_length },
              { label: 'E/A/D', value: rec.data?.eliminations != null ? `${rec.data.eliminations} / ${rec.data.assists} / ${rec.data.deaths}` : null },
            ]"
            :key="fd.label"
            class="field-cell"
            :class="{ filled: !!fd.value, vacant: !fd.value }"
          >
            <span class="field-label">{{ fd.label }}</span>
            <span class="field-value">{{ fd.value || '—' }}</span>
          </div>
        </div>

        <!-- Expanded: source files + previews + any stats that parsed -->
        <template v-if="cardState.isSelected(rec.match_key)">
          <div class="unknown-expanded">
            <div v-if="rec.source_files?.length" class="unknown-sources">
              <div class="block-eyebrow">
                Source Files
              </div>
              <div v-for="f in rec.source_files" :key="f" class="source-file">
                <a
                  class="source-name"
                  :href="screenshotURL(f)"
                  :title="cardState.previewOpen.value[f] ? 'Hide preview' : 'Show preview'"
                  @click.prevent="cardState.togglePreview(f)"
                >
                  <span class="chev small" :class="{ open: cardState.previewOpen.value[f] }">›</span>
                  <span class="source-name-text">{{ f }}</span>
                </a>
                <span
                  v-if="rec.source_parsed_at?.[f]"
                  class="source-parsed-chip"
                  :title="`Inserted into the database at ${rec.source_parsed_at[f]} (UTC)`"
                >{{ formatParsedAt(rec.source_parsed_at[f]) }}</span>
                <img
                  v-if="cardState.previewOpen.value[f] && !cardState.previewError.value[f]"
                  :src="screenshotURL(f)"
                  :alt="f"
                  class="source-preview"
                  @error="cardState.onPreviewError(f)"
                >
                <div v-if="cardState.previewOpen.value[f] && cardState.previewError.value[f]" class="source-preview-error">
                  Could not load image — check screenshots folder in Settings.
                </div>
              </div>
            </div>

            <div v-if="rec.data?.eliminations != null || rec.data?.damage != null" class="unknown-stats">
              <div class="block-eyebrow">
                Parsed Stats
              </div>
              <div class="stats">
                <div class="stat">
                  <span class="stat-value">{{ rec.data.eliminations ?? '—' }}</span>
                  <span class="stat-label">Elims</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ rec.data.assists ?? '—' }}</span>
                  <span class="stat-label">Assists</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ rec.data.deaths ?? '—' }}</span>
                  <span class="stat-label">Deaths</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ rec.data.damage != null ? rec.data.damage.toLocaleString() : '—' }}</span>
                  <span class="stat-label">Damage</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ rec.data.healing != null ? rec.data.healing.toLocaleString() : '—' }}</span>
                  <span class="stat-label">Healing</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ rec.data.mitigation != null ? rec.data.mitigation.toLocaleString() : '—' }}</span>
                  <span class="stat-label">Mitigation</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </article>
    </div>
  </section>
</template>

<style scoped>
/* ─── View intro ─────────────────────────────────────────── */

/* The heading em uses the draw/amber color — "attention, not alarm" */
.unknown-heading em {
  color: var(--draw);
  background: var(--draw-soft);
  font-style: normal;
  padding: 0 0.25rem;
  margin: 0 -0.05rem;
  border-radius: 1px;
}
:global([data-theme="light"]) .unknown-heading em { color: var(--draw); }

.unknown-desc {
  margin-top: 0.65rem;
  color: var(--text-dim);
  font-size: 0.875rem;
  line-height: 1.6;
  max-width: 64ch;
}

/* ─── Unknown-record cards ───────────────────────────────── */

.unknown-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  margin-top: 1.6rem;
}

/* Each unknown record is a card with an amber left bar */
.unknown-card {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--surface);
  overflow: hidden;
  transition: border-color 180ms ease, background 180ms ease;
}

.unknown-card::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--draw-line);
}

.unknown-card.expanded {
  border-color: var(--border-strong);
  background: var(--surface-2);
}

/* Card header row */
.unknown-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8rem 1rem 0.8rem 1.4rem;
  cursor: pointer;
  user-select: none;
  transition: background 140ms ease;
}

.unknown-card-head:hover { background: var(--surface-2); }
.unknown-card.expanded .unknown-card-head { background: transparent; }

.unknown-head-lhs {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
  flex: 1;
}

.unknown-idx {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-faint);
  letter-spacing: 0.06em;
  flex-shrink: 0;
}

.unknown-key-block {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.unknown-key {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.01em;
}

.unknown-src-count {
  font-size: 0.69rem;
  color: var(--text-faint);
}

.unknown-head-rhs {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex-shrink: 0;
}

/* ─── 8-column field diagnostic strip ────────────────────── */

.unknown-fields {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  border-top: 1px solid var(--border-soft);
  padding: 0 1rem 0 1.4rem;
}

.field-cell {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  padding: 0.5rem 0.5rem 0.5rem 0;
  border-right: 1px solid var(--border-soft);
}

.field-cell:last-child { border-right: none; }

.field-label {
  font-size: 0.6rem;
  font-family: var(--mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
  line-height: 1;
}

.field-value {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.field-cell.filled .field-label { color: var(--text-dim); }
.field-cell.filled .field-value { color: var(--text); }

.field-cell.vacant .field-value {
  font-style: italic;
  font-size: 0.72rem;
}

/* ─── Expanded section: sources + stats ──────────────────── */

.unknown-expanded {
  border-top: 1px solid var(--border-soft);
  padding: 1rem 1.4rem;
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.unknown-sources {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.unknown-sources .block-eyebrow {
  margin-bottom: 0.45rem;
}

.unknown-stats .block-eyebrow {
  margin-bottom: 0.6rem;
}
</style>
