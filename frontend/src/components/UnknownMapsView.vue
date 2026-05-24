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
        <strong class="empty-link" @click="emit('go-to-view', 'ingest')">run Parse</strong>
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
        :key="rec.id"
        class="unknown-card"
        :class="{ expanded: cardState.isExpanded(rec.id) }"
      >
        <!-- Card header: index + match key + slot chips + chevron -->
        <div class="unknown-card-head" @click="cardState.toggleExpand(rec.id)">
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
            <span class="chev" :class="{ open: cardState.isExpanded(rec.id) }" aria-hidden="true">›</span>
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
        <template v-if="cardState.isExpanded(rec.id)">
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
/* Per-source-file "first inserted" timestamp chip — sits next to the
   source filename in the diagnostic source list. Same italic/dim
   treatment as the matching chip in MatchCard so the two views read
   consistently when a user jumps between them. */

.source-parsed-chip {
  font-family: var(--mono);
  font-size: 0.68rem;
  font-style: italic;
  color: var(--text-faint);
  letter-spacing: 0.02em;
  white-space: nowrap;
  margin-left: 0.35rem;
  opacity: 0.78;
}
</style>
