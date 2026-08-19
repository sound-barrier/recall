<script setup lang="ts">
import { computed } from 'vue'

import type { MatchRecord } from '@/api-client'
import CoachHeroSplit from '@/components/coach/room/CoachHeroSplit.vue'
import { DEFAULT_COACH_LABELS, type CoachLabels, type RoomVoice } from '@/components/coach/room/coach-room-props'
import MatchRankBlock from '@/components/matches/detail/MatchRankBlock.vue'
import { formatPlayerDay, playerClockDayKey, playerClockTime } from '@/match/coach/coach-time'
import { formatPlayModeLabel, formatQueueTypeLabel, formatUnknownMapLabel } from '@/match/match-label-helpers'
import { playerClockOwner } from '@/match/match-time-helpers'

// The desk: one match, in full, as the coach reads it. Everything here
// is the PLAYER's — their clock (labeled, because the coach is usually
// in another timezone), their note, their tags. There is no submap in this
// data, so the card says map + game mode and nothing finer.

const props = withDefaults(defineProps<{
  record: MatchRecord
  /** The player's handle — the clock label names whose clock this is. */
  handle: string
  /** Whose matches these are, for the possessives. */
  voice?: RoomVoice
  labels?: CoachLabels
}>(), { labels: () => DEFAULT_COACH_LABELS, voice: 'their' })

const data = computed(() => props.record.data ?? {})
const mapName = computed(() => props.labels.map(data.value.map) || formatUnknownMapLabel(props.record))
const result = computed(() => data.value.result ?? '')
const resultWord = computed(() => (result.value ? result.value[0]!.toUpperCase() + result.value.slice(1) : 'No result'))
const RESULT_TINT: Record<string, string> = { victory: 'win', defeat: 'loss', draw: 'draw' }
const resultTint = computed(() => RESULT_TINT[result.value] ?? 'none')

// One definition of whose clock this is — playerClockNote falls back to
// "the player" when a bundle named nobody, a state the identity prompt
// makes reachable. In the viewer's own voice it is simply "your".
const possessive = computed(() => (props.voice === 'your' ? 'your' : `${playerClockOwner(props.handle)}'s`))
const ownNoteLabel = computed(() => (props.voice === 'your' ? 'Your own note' : `${props.handle}'s own note`))

const whenLabel = computed(() => {
  const day = formatPlayerDay(playerClockDayKey(props.record))
  const clock = playerClockTime(props.record)
  return [day, clock].filter(Boolean).join(' · ') || 'Not dated'
})

const thousands = (value: number) => value.toLocaleString()

const stats = computed(() => [
  { label: 'Elims', value: data.value.eliminations },
  { label: 'Assists', value: data.value.assists },
  { label: 'Deaths', value: data.value.deaths },
  { label: 'Healing', value: data.value.healing, format: thousands },
])

// The rank block prints the modifiers itself, so the meta row only
// carries them for a match that arrived without a rank screen.
const looseModifiers = computed(() => (data.value.rank ? [] : data.value.modifiers ?? []))
const annotation = computed(() => props.record.annotation)

// What has already been said about this match, quoted under the player's
// own note so a reviewer reads it before writing: an earlier coach's block,
// and — on someone else's desk — the player's own sitting notes (a coach
// reads what the player already noticed). On your own desk your sittings
// are the editor itself, not a quote.
const earlierWords = computed(() => {
  const coach = (props.record.coach_notes ?? [])
    .filter((n) => n.text)
    .map((n) => ({ key: `coach-${n.id}`, who: `${n.coach_name} · ${n.session_date}`, text: n.text }))
  if (props.voice === 'your') return coach
  const own = (props.record.self_review_notes ?? [])
    .filter((n) => n.text)
    .map((n) => ({
      key: `self-${n.review_id}`,
      who: `${playerClockOwner(props.handle)}'s own review${n.review_title ? ` · ${n.review_title}` : ''}`,
      text: n.text,
    }))
  return [...coach, ...own]
})
</script>

<template>
  <article class="coach-card" aria-labelledby="coach-card-title">
    <header class="card-head">
      <h2 id="coach-card-title" class="card-map">
        {{ mapName }}
      </h2>
      <p class="card-result" :class="resultTint">
        <span class="card-result-word">{{ resultWord }}</span>
        <span v-if="data.final_score" class="card-score">{{ data.final_score }}</span>
      </p>
    </header>

    <div class="card-meta">
      <div class="meta-cell">
        <span class="eyebrow">When · {{ possessive }} clock</span>
        <span class="meta-value">{{ whenLabel }}</span>
      </div>
      <div class="meta-cell">
        <span class="eyebrow">Mode</span>
        <span class="meta-value meta-badges">
          <span v-if="data.game_mode" class="badge mode">{{ data.game_mode }}</span>
          <span class="badge type">{{ formatQueueTypeLabel(record) }}</span>
          <span class="badge type">{{ formatPlayModeLabel(record) }}</span>
        </span>
      </div>
      <div v-if="looseModifiers.length" class="meta-cell">
        <span class="eyebrow">Modifiers</span>
        <span class="meta-value meta-badges">
          <span v-for="modifier in looseModifiers" :key="modifier" class="badge type">{{ modifier }}</span>
        </span>
      </div>
    </div>

    <ul class="card-stats">
      <li v-for="stat in stats" :key="stat.label" class="stat-cell">
        <span class="eyebrow">{{ stat.label }}</span>
        <span class="stat-value">{{ stat.value == null ? '—' : (stat.format ?? String)(stat.value) }}</span>
      </li>
    </ul>

    <MatchRankBlock v-if="data.rank" :record="record" />

    <section v-if="data.heroes_played?.length" class="card-section">
      <span class="eyebrow">Heroes played</span>
      <CoachHeroSplit :heroes="data.heroes_played" :labels="labels" />
    </section>

    <section v-if="annotation?.note" class="card-section">
      <span class="eyebrow">{{ ownNoteLabel }}</span>
      <blockquote class="card-quote">
        {{ annotation.note }}
      </blockquote>
    </section>

    <section v-if="earlierWords.length" class="card-section" aria-label="Earlier reviews">
      <span class="eyebrow">Already said about this match</span>
      <blockquote v-for="said in earlierWords" :key="said.key" class="card-quote">
        <span class="eyebrow card-quote-who">{{ said.who }}</span>
        {{ said.text }}
      </blockquote>
    </section>

    <footer v-if="annotation?.tags?.length || annotation?.replay_code" class="card-foot">
      <span v-for="tag in annotation?.tags ?? []" :key="tag" class="badge">{{ tag }}</span>
      <span v-if="annotation?.replay_code" class="card-replay">
        <span class="eyebrow">Replay</span>
        <span class="card-replay-code">{{ annotation.replay_code }}</span>
      </span>
    </footer>
  </article>
</template>

<style scoped>
.coach-card {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1rem 1.1rem 1.1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.8rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--hairline);
}

.card-map {
  margin: 0;
  font-family: var(--display);
  font-style: italic;
  font-size: 1.9rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.01em;
  color: var(--identity-accent);
  text-transform: uppercase;
}

.card-result {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0;
}

.card-result-word {
  font-family: var(--mono);
  font-size: var(--type-sm);
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.card-result.win  .card-result-word { color: var(--win); }
.card-result.loss .card-result-word { color: var(--loss); }
.card-result.draw .card-result-word { color: var(--draw); }

.card-score {
  font-family: var(--mono);
  font-size: var(--type-2xl);
  color: var(--text);
  font-feature-settings: "tnum";
}

.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem 1.6rem;
}

.meta-cell, .stat-cell, .card-section {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.meta-value {
  font-size: var(--type-lg);
  color: var(--text);
}

.meta-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.card-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.6rem;
  margin: 0;
  padding: 0.7rem 0;
  border-top: 1px solid var(--hairline);
  border-bottom: 1px solid var(--hairline);
  list-style: none;
}

.stat-value {
  font-family: var(--mono);
  font-size: var(--type-4xl);
  color: var(--text);
  font-feature-settings: "tnum";
}

/* The kicker is the shared .eyebrow; this class is layout only. */
.card-quote-who {
  display: block;
  margin-bottom: 0.15rem;
}

.card-quote {
  margin: 0;
  padding: 0.5rem 0.8rem;
  font-size: var(--type-lg);
  line-height: 1.5;
  color: var(--text-dim);
  background: var(--surface-2);
  border-left: 2px solid var(--border-strong);
  border-radius: 0 var(--radius) var(--radius) 0;
}

.card-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.7rem;
}

.card-replay {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
}

.card-replay-code {
  font-family: var(--mono);
  font-size: var(--type-sm);
  letter-spacing: 0.12em;
  color: var(--text-dim);
}
</style>
