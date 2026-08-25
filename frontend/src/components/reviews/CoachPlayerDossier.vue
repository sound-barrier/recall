<script setup lang="ts">
import { computed, ref } from 'vue'

import type { CoachPlayerSummary } from '@/api-client'
import { useCoachPlayerNotesQuery } from '@/queries/selfReview'
import { captureParts, formatPlayerDay, localDay } from '@/match/coach/coach-time'
import { parseMatchKey } from '@/match/match-key'
import { pluralize } from '@/match/match-label-helpers'

// The dossier — one coached identity's continuity, on paper. Everything
// here except the note list is data the roster row already carried; the
// notes fetch on demand, because a coach opens a dossier to glance far
// more often than to re-read an entire file.
//
// Deliberately WITHOUT a session history: the database keeps no record of
// when a session happened (only each note's own timestamps), so "last
// session" here honestly means "last note touched". Grouping by sitting
// is the assessment's Tier 2.

const props = defineProps<{ player: CoachPlayerSummary }>()

const emit = defineEmits<{
  /** Open the codes door pre-addressed to this identity. */
  'review-codes': []
}>()

const notesOpen = ref(false)
const notesQuery = useCoachPlayerNotesQuery(() => props.player.id, notesOpen)
const notes = computed(() => notesQuery.data.value ?? [])

const subLine = computed(() => {
  const count = pluralize(props.player.note_count, 'note')
  const last = props.player.last_note_at ? ` · last note ${localDay(props.player.last_note_at)}` : ''
  return `${count}${last}`
})

// The match KEY is the label: a dated capture key reads as its day, a
// replay key reads as its code. No match context is stored coach-side —
// the loaned matches left with their sessions.
function noteLabel(matchKey: string): string {
  const captured = captureParts(matchKey)
  if (captured) return formatPlayerDay(captured.date)
  const parsed = parseMatchKey(matchKey)
  return parsed.kind === 'replay' ? parsed.body : matchKey
}
</script>

<template>
  <section class="paper dossier" :aria-label="`${player.handle} — coaching dossier`">
    <p class="eyebrow ink dossier-eyebrow">
      Coaching dossier
    </p>
    <h4 class="dossier-name">
      {{ player.handle }}
    </h4>
    <p class="dossier-sub">
      {{ subLine }}
    </p>

    <template v-if="player.focus_items?.length">
      <p class="eyebrow ink">
        What they're working on now
      </p>
      <ul class="dossier-focus">
        <li v-for="item in player.focus_items" :key="item">
          {{ item }}
        </li>
      </ul>
    </template>

    <div class="dossier-actions">
      <button type="button" class="paper-btn primary" @click="emit('review-codes')">
        Review new codes for {{ player.handle }}
      </button>
      <button type="button" class="paper-btn" :aria-expanded="notesOpen" @click="notesOpen = !notesOpen">
        Read every note
      </button>
    </div>

    <div v-if="notesOpen" class="dossier-notes">
      <p v-if="notesQuery.isPending.value" class="dossier-sub" role="status">
        Reading the file…
      </p>
      <p v-else-if="notes.length === 0" class="dossier-sub">
        Nothing written yet — the file starts with the first note.
      </p>
      <ul v-else class="dossier-note-list">
        <li v-for="n in notes" :key="n.note_id" class="dossier-note">
          <span class="dossier-note-from">
            <span class="dossier-note-key">{{ noteLabel(n.match_key) }}</span>
            <span v-if="n.match_clock" class="dossier-note-clock">at {{ n.match_clock }}</span>
          </span>
          <p class="dossier-note-text">
            {{ n.kind === 'reviewed_only' ? 'Reviewed — nothing to add.' : n.text }}
          </p>
          <span v-if="n.focus_tags.length" class="dossier-note-tags">{{ n.focus_tags.join(' · ') }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.dossier {
  display: grid;
  gap: 0.35rem;
  padding: 0.9rem 1rem 1rem;
  margin: 0.35rem 0 0.2rem;
}

.dossier-eyebrow {
  margin: 0;
}

.dossier-name {
  margin: 0;
  font-family: var(--display);
  font-style: italic;
  font-size: var(--type-4xl);
  font-weight: 800;
  line-height: 1.05;
  color: var(--ink);
  text-transform: uppercase;
}

.dossier-sub {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--type-3xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.dossier-focus {
  margin: 0;
  padding-left: 1.05rem;
  font-size: var(--type-md);
  color: var(--ink);
}

.dossier-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.3rem;
}

.dossier-notes {
  margin-top: 0.35rem;
  border-top: 1px solid var(--paper-rule);
}

.dossier-note-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.dossier-note {
  display: grid;
  gap: 0.1rem;
  padding: 0.55rem 0.1rem;
  border-bottom: 1px solid var(--paper-rule);
}

.dossier-note:last-child {
  border-bottom: 0;
}

.dossier-note-from {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
}

.dossier-note-key {
  font-family: var(--mono);
  font-size: var(--type-3xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-dim);
}

.dossier-note-clock {
  font-family: var(--mono);
  font-size: var(--type-3xs);
  color: var(--ink-faint);
}

.dossier-note-text {
  margin: 0;
  font-size: var(--type-md);
  color: var(--ink);
}

.dossier-note-tags {
  font-family: var(--mono);
  font-size: var(--type-3xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
</style>
