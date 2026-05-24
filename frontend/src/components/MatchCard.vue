<script setup lang="ts">
import type { MatchRecord } from '../api'
import {
  fmtTime,
  heroesForHeader,
  screenshotURL,
  detectScreenshotSlots,
  missingRequiredSlots,
  missingOptionalSlots,
  sshotTypeLabel,
  sourceType,
  formatParsedAt,
} from '../match-helpers'

const props = defineProps<{
  record: MatchRecord
  index: number
  isExpanded: boolean
  isSourcesOpen: boolean
  previewOpen: Record<string, boolean>
  previewError: Record<string, boolean>
  isActive: (field: string, value: string) => boolean
}>()

const emit = defineEmits<{
  'toggle-expand': []
  'toggle-sources': []
  'toggle-preview': [filename: string]
  'preview-error': [filename: string]
  'filter-toggle': [field: string, value: string]
}>()
</script>

<template>
  <article
    class="match"
    :class="[
      { expanded: isExpanded },
      `result-${record.data?.result || 'unknown'}`,
    ]"
  >
    <span class="match-bar" aria-hidden="true" />
    <div class="match-body">
      <!-- Header is a mouse-clickable region for convenience, but the
           keyboard affordance for expand/collapse is the chev button on
           the right. Nested interactive elements (chip buttons inside a
           header button) are invalid HTML / ARIA, so the outer div
           intentionally has no role or tabindex. -->
      <div
        class="match-header"
        @click="emit('toggle-expand')"
      >
        <div class="match-title-row">
          <div class="match-title-lhs">
            <span class="match-index">{{ String(index + 1).padStart(2, '0') }}</span>
            <button
              type="button"
              class="match-map clickable"
              :class="{ active: isActive('map', record.data?.map ?? '') }"
              :aria-label="`Filter by map: ${record.data?.map || 'Unknown Map'}`"
              :aria-pressed="isActive('map', record.data?.map ?? '')"
              @click.stop="emit('filter-toggle', 'map', record.data?.map ?? '')"
            >
              {{ record.data?.map || 'Unknown Map' }}
            </button>
          </div>
          <div class="match-title-rhs">
            <span v-if="fmtTime(record)" class="when">{{ fmtTime(record) }}</span>
            <span v-if="record.data?.game_length" class="length"><span class="length-mark">▮</span>{{ record.data.game_length }}</span>
            <button
              type="button"
              class="chev chev-btn"
              :class="{ open: isExpanded }"
              :aria-expanded="isExpanded"
              :aria-label="`${record.data?.map || 'Unknown map'} — ${isExpanded ? 'collapse' : 'expand'} match details`"
              @click.stop="emit('toggle-expand')"
            >
              ›
            </button>
          </div>
        </div>

        <div class="match-tag-row">
          <button
            v-if="record.data?.mode"
            type="button"
            class="badge mode clickable"
            :class="{ active: isActive('mode', record.data.mode) }"
            :aria-label="`Filter by mode: ${record.data.mode}`"
            :aria-pressed="isActive('mode', record.data.mode)"
            @click.stop="emit('filter-toggle', 'mode', record.data.mode)"
          >
            {{ record.data.mode }}
          </button>
          <button
            v-if="record.data?.type"
            type="button"
            class="badge type clickable"
            :class="{ active: isActive('type', record.data.type) }"
            :aria-label="`Filter by game type: ${record.data.type}`"
            :aria-pressed="isActive('type', record.data.type)"
            @click.stop="emit('filter-toggle', 'type', record.data.type)"
          >
            {{ record.data.type }}
          </button>
          <button
            v-if="record.data?.role"
            type="button"
            class="badge role clickable"
            :class="[record.data.role, { active: isActive('role', record.data.role) }]"
            :aria-label="`Filter by role: ${record.data.role}`"
            :aria-pressed="isActive('role', record.data.role)"
            @click.stop="emit('filter-toggle', 'role', record.data.role)"
          >
            {{ record.data.role }}
          </button>
          <template v-for="hp in heroesForHeader(record)" :key="hp.hero">
            <button
              type="button"
              class="badge hero clickable"
              :class="{ active: isActive('hero', hp.hero) }"
              :aria-label="hp.percent_played != null ? `Filter by hero: ${hp.hero}, ${hp.percent_played}% played` : `Filter by hero: ${hp.hero}`"
              :aria-pressed="isActive('hero', hp.hero)"
              @click.stop="emit('filter-toggle', 'hero', hp.hero)"
            >
              <span class="hero-name-inline">{{ hp.hero }}</span>
              <span v-if="hp.percent_played != null" class="hero-pct-inline">{{ hp.percent_played }}%</span>
            </button>
          </template>
          <button
            v-if="record.data?.result"
            type="button"
            class="badge result clickable"
            :class="[record.data.result, { active: isActive('result', record.data.result) }]"
            :aria-label="`Filter by result: ${record.data.result}`"
            :aria-pressed="isActive('result', record.data.result)"
            @click.stop="emit('filter-toggle', 'result', record.data.result)"
          >
            {{ record.data.result }}
          </button>
          <span
            v-if="missingRequiredSlots(record).length"
            class="incomplete-badge"
            :title="`Incomplete match — missing ${missingRequiredSlots(record).map(s => s.label).join(', ')} screenshot${missingRequiredSlots(record).length === 1 ? '' : 's'}. Expand for details.`"
          >
            <span class="incomplete-glyph" aria-hidden="true">!</span>
            <span class="incomplete-text">missing <strong>{{ missingRequiredSlots(record).map(s => s.label).join(' · ') }}</strong></span>
          </span>
        </div>
      </div>

      <template v-if="isExpanded">
        <div class="match-expanded">
          <div v-if="record.data?.final_score" class="meta-row">
            <span class="meta-eyebrow">Final Score</span>
            <span class="meta-value">{{ record.data.final_score }}</span>
          </div>

          <div v-if="record.parsed_at" class="meta-row meta-row-parsed">
            <span class="meta-eyebrow">Parsed</span>
            <span class="meta-value" :title="record.parsed_at">{{ formatParsedAt(record.parsed_at) }}</span>
          </div>

          <div class="stats">
            <div class="stat">
              <span class="stat-value">{{ record.data?.eliminations ?? '—' }}</span>
              <span class="stat-label">Elims</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ record.data?.assists ?? '—' }}</span>
              <span class="stat-label">Assists</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ record.data?.deaths ?? '—' }}</span>
              <span class="stat-label">Deaths</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ record.data?.damage != null ? record.data.damage.toLocaleString() : '—' }}</span>
              <span class="stat-label">Damage</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ record.data?.healing != null ? record.data.healing.toLocaleString() : '—' }}</span>
              <span class="stat-label">Healing</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ record.data?.mitigation != null ? record.data.mitigation.toLocaleString() : '—' }}</span>
              <span class="stat-label">Mitigation</span>
            </div>
          </div>

          <div v-if="record.data?.rank" class="rank-block">
            <div class="block-eyebrow">
              Rank
            </div>
            <div class="rank-line">
              <span class="rank-tier" :class="record.data.rank">{{ record.data.rank }} {{ record.data.level }}</span>
              <span v-if="record.data.rank_progress" class="rank-progress">{{ record.data.rank_progress }}% progress</span>
              <span v-if="record.data.change_percent" class="rank-change">+{{ record.data.change_percent }}%</span>
              <span v-for="m in record.data.modifiers" :key="m" class="rank-modifier">{{ m }}</span>
            </div>
            <div v-if="record.data.sr?.length" class="sr-line">
              <span v-for="s in record.data.sr" :key="s.hero" class="sr-entry">
                <span class="sr-hero">{{ s.hero }}</span>
                <span class="sr-value">{{ s.sr }}</span>
                <span class="sr-delta" :class="s.change >= 0 ? 'up' : 'down'">{{ s.change >= 0 ? '+' : '' }}{{ s.change }}</span>
              </span>
            </div>
          </div>

          <div v-if="record.data?.heroes_played?.length" class="heroes-played">
            <div class="block-eyebrow">
              Heroes Played
            </div>
            <div class="heroes-played-items">
              <div v-for="hp in record.data.heroes_played" :key="hp.hero" class="hero-block">
                <div class="hero-header">
                  <button
                    type="button"
                    class="hero-name clickable"
                    :class="{ active: isActive('hero', hp.hero) }"
                    :aria-label="`Filter by hero: ${hp.hero}`"
                    :aria-pressed="isActive('hero', hp.hero)"
                    @click="emit('filter-toggle', 'hero', hp.hero)"
                  >
                    {{ hp.hero }}
                  </button>
                  <span class="hero-pct">{{ hp.percent_played }}%</span>
                  <span v-if="hp.play_time" class="hero-time">{{ hp.play_time }}</span>
                </div>
                <div v-if="hp.stats && Object.keys(hp.stats).length" class="personal-grid">
                  <div v-for="(v, k) in hp.stats" :key="k" class="personal-item">
                    <span class="personal-label">{{ k.replace(/_/g, ' ') }}</span>
                    <span class="personal-value">{{ v }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="record.source_files?.length" class="sources-block">
            <div class="sources-toggle" @click="emit('toggle-sources')">
              <span class="chev small" :class="{ open: isSourcesOpen }">›</span>
              <span class="sources-label">Source Screenshots</span>
              <span class="sources-count">{{ record.source_files.length }}</span>
              <span class="sources-coverage" :title="`${detectScreenshotSlots(record).filter(s => s.present).length} of ${detectScreenshotSlots(record).length} screenshot types captured`">
                <component
                  :is="slot.present ? 'button' : 'span'"
                  v-for="slot in detectScreenshotSlots(record)"
                  :key="slot.key"
                  :type="slot.present ? 'button' : undefined"
                  class="slot-chip"
                  :class="{
                    present: slot.present,
                    absent: !slot.present,
                    optional: !slot.required,
                    'absent-required': !slot.present && slot.required,
                    clickable: slot.present,
                    active: slot.present && isActive('sshot', slot.key),
                  }"
                  :title="slot.present ? `Click to filter to matches that have a ${slot.label} screenshot. ${slot.hint}` : slot.hint"
                  :aria-label="slot.present ? `Filter by source: ${slot.label} present` : `${slot.label} screenshot not captured`"
                  :aria-pressed="slot.present ? isActive('sshot', slot.key) : undefined"
                  @click.stop="slot.present && emit('filter-toggle', 'sshot', slot.key)"
                >
                  <span class="slot-dot" aria-hidden="true" />
                  {{ slot.label }}
                  <span v-if="!slot.required" class="slot-optional-tag">opt</span>
                </component>
              </span>
            </div>
            <div v-if="isSourcesOpen" class="sources">
              <div v-for="f in record.source_files" :key="f" class="source-file">
                <div class="source-row">
                  <a
                    class="source-name"
                    :href="screenshotURL(f)"
                    :title="props.previewOpen[f] ? 'Hide preview' : 'Show preview'"
                    @click.prevent="emit('toggle-preview', f)"
                  >
                    <span class="chev small" :class="{ open: props.previewOpen[f] }">›</span>
                    <span class="source-name-text">{{ f }}</span>
                  </a>
                  <button
                    v-if="sourceType(record, f)"
                    type="button"
                    class="source-type-chip clickable"
                    :class="[
                      `source-type-${sourceType(record, f)}`,
                      { active: isActive('sshot', sourceType(record, f)) },
                    ]"
                    :aria-label="`Filter by source type: ${sshotTypeLabel(sourceType(record, f))}`"
                    :aria-pressed="isActive('sshot', sourceType(record, f))"
                    @click.stop="emit('filter-toggle', 'sshot', sourceType(record, f))"
                  >
                    {{ sshotTypeLabel(sourceType(record, f)) }}
                  </button>
                  <span
                    v-else
                    class="source-type-chip unknown"
                    title="Type not yet recorded — parsed before per-file type tracking landed. Clear the database and re-parse to populate."
                  >?</span>
                  <span
                    v-if="record.source_parsed_at?.[f]"
                    class="source-parsed-chip"
                    :title="`Inserted into the database at ${record.source_parsed_at[f]} (UTC)`"
                  >{{ formatParsedAt(record.source_parsed_at[f]) }}</span>
                </div>
                <img
                  v-if="props.previewOpen[f] && !props.previewError[f]"
                  :src="screenshotURL(f)"
                  :alt="f"
                  class="source-preview"
                  @error="emit('preview-error', f)"
                >
                <div v-if="props.previewOpen[f] && props.previewError[f]" class="source-preview-error">
                  Could not load image — check screenshots folder in Settings.
                </div>
              </div>
            </div>

            <div v-if="isSourcesOpen && (missingRequiredSlots(record).length || missingOptionalSlots(record).length)" class="sources-explain">
              <p v-for="slot in missingRequiredSlots(record)" :key="slot.key" class="coverage-line required">
                <span class="coverage-line-tag">⚠ {{ slot.label }} missing</span>
                <span class="coverage-line-text">
                  Capture the post-match <strong>{{ slot.label }}</strong> tab and re-parse to recover: {{ slot.missing }}.
                </span>
              </p>
              <p v-for="slot in missingOptionalSlots(record)" :key="slot.key" class="coverage-line optional">
                <span class="coverage-line-tag">· {{ slot.label }} not captured</span>
                <span class="coverage-line-text">
                  Optional — recommended for ranked matches. Provides: {{ slot.missing }}.
                </span>
              </p>
            </div>
          </div>
        </div>
      </template>
    </div>
  </article>
</template>

<style scoped>
/* Per-source-file "first inserted" timestamp chip — sits next to the
   source-type chip in the Sources panel. Italic + dimmed so it reads
   as ambient metadata rather than an interactive control (it's
   intentionally not clickable; users cannot filter by parse date). */

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

/* Match-level "Parsed" meta row: same shape as the existing Final
   Score meta row; the parsed row gets a touch of breathing room
   so the two stack cleanly when both render. */

.meta-row-parsed {
  margin-top: 0.18rem;
}
</style>
