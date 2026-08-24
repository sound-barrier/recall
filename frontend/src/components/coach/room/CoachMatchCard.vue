<script setup lang="ts">
import NoteProse from '@/components/coach/notes/NoteProse.vue'
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
  /** A sitting whose own block is the editor on this desk, not a quote. */
  omitReviewId?: string
  labels?: CoachLabels
}>(), { labels: () => DEFAULT_COACH_LABELS, voice: 'their', omitReviewId: '' })

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
// In self voice "Your own note" sat one card above the editor's "Your
// note" — two near-identical labels for a read-only quote and a live
// field. The quote now names its source instead.
const ownNoteLabel = computed(() => (props.voice === 'your' ? 'From your match journal' : `${props.handle}'s own note`))

// Whether the two mode chips have a real value to say — the template
// omits their unknown fallbacks (see the comment there).
const queueKnown = computed(() => props.record.queue_type === 'role' || props.record.queue_type === 'open')
const playModeKnown = computed(() => {
  const m = props.record.play_mode ?? data.value.playlist
  return m === 'quickplay' || m === 'competitive'
})

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
// and the player's own sitting notes — on a coach's desk, every one (a
// coach reads what the player already noticed); on your own desk, every
// one but the sitting open on it, whose note is the editor, not a quote.
const earlierWords = computed(() => {
  const coach = (props.record.coach_notes ?? [])
    .filter((n) => n.text)
    .map((n) => ({ key: `coach-${n.id}`, who: `${n.coach_name} · ${n.session_date}`, text: n.text }))
  const whose = props.voice === 'your' ? 'Your own review' : `${playerClockOwner(props.handle)}'s own review`
  const own = (props.record.self_review_notes ?? [])
    .filter((n) => n.text && n.review_id !== props.omitReviewId)
    .map((n) => ({
      key: `self-${n.review_id}`,
      who: `${whose}${n.review_title ? ` · ${n.review_title}` : ''}`,
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
        <span class="eyebrow">{{ voice === 'your' ? 'When' : `When · ${possessive} clock` }}</span>
        <span class="meta-value">{{ whenLabel }}</span>
      </div>
      <!--
        Unknown fallbacks are omitted here, unlike the Matches table: a
        column reads best when every row carries a chip, but on a lone card
        an all-caps UNKNOWN between two real facts reads as an error in the
        data the coach was handed — and they cannot fix a loaned record.
      -->
      <div v-if="data.game_mode || queueKnown || playModeKnown" class="meta-cell">
        <span class="eyebrow">Mode</span>
        <span class="meta-value meta-badges">
          <span v-if="data.game_mode" class="badge mode">{{ data.game_mode }}</span>
          <span v-if="queueKnown" class="badge type">{{ formatQueueTypeLabel(record) }}</span>
          <span v-if="playModeKnown" class="badge type">{{ formatPlayModeLabel(record) }}</span>
        </span>
      </div>
      <div v-if="looseModifiers.length" class="meta-cell">
        <span class="eyebrow">Modifiers</span>
        <span class="meta-value meta-badges">
          <span v-for="modifier in looseModifiers" :key="modifier" class="badge type">{{ modifier }}</span>
        </span>
      </div>
    </div>

    <!--
      In your own voice the numbers fold away: you played the match, and on
      a 720-tall laptop window they pushed the entire writing surface — the
      room's whole point — below the fold. A coach reads a stranger's match,
      so their card keeps the numbers open.
    -->
    <details v-if="voice === 'your'" class="card-numbers" role="group">
      <summary class="eyebrow card-numbers-summary">
        The numbers
      </summary>
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
    </details>
    <template v-else>
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
    </template>

    <section v-if="annotation?.note" class="card-section">
      <span class="eyebrow">{{ ownNoteLabel }}</span>
      <blockquote class="card-quote">
        <NoteProse :text="annotation.note" />
      </blockquote>
    </section>

    <section v-if="earlierWords.length" class="card-section" aria-label="Earlier reviews">
      <span class="eyebrow">Already said about this match</span>
      <blockquote v-for="said in earlierWords" :key="said.key" class="card-quote">
        <span class="eyebrow card-quote-who">{{ said.who }}</span>
        <NoteProse :text="said.text" />
      </blockquote>
    </section>

    <footer v-if="annotation?.tags?.length || annotation?.replay_code" class="card-foot">
      <!-- The hash form Matches uses, in a muted chip: a bare STACK badge
           read as a control that did nothing when clicked. -->
      <span v-for="tag in annotation?.tags ?? []" :key="tag" class="badge card-tag">#{{ tag }}</span>
      <span v-if="annotation?.replay_code" class="card-replay">
        <span class="eyebrow">Replay</span>
        <span class="card-replay-code">{{ annotation.replay_code }}</span>
      </span>
    </footer>
  </article>
</template>

<style scoped src="./coach-match-card.css"></style>
