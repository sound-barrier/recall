<script setup lang="ts">
import { computed, ref } from 'vue'

import type { CoachPlayerSummary, CoachSession } from '@/api-client'
import { useCoachPlayerNotesQuery, useCoachPlayerSessionsQuery } from '@/queries/selfReview'
import { localDay, matchKeyLabel } from '@/match/coach/coach-time'
import { pluralize } from '@/match/match-label-helpers'

// The dossier — one coached identity's continuity, on paper. Everything
// here except the note list is data the roster row already carried; the
// notes fetch on demand, because a coach opens a dossier to glance far
// more often than to re-read an entire file.
//
// The session list is the continuity: when they met, what it covered, and
// what the focus list said at the end. It replaces the era when the
// database kept no record of a sitting at all and "last session" honestly
// meant "last note touched" — a sitting that produced no notes left no
// trace whatsoever.
//
// Fetched with the notes rather than with the roster row: a coach opens a
// dossier to glance far more often than to re-read a whole file.

const props = defineProps<{ player: CoachPlayerSummary }>()

const emit = defineEmits<{
  /** Open the codes door pre-addressed to this identity. */
  'review-codes': []
}>()

const notesOpen = ref(false)
const notesQuery = useCoachPlayerNotesQuery(() => props.player.id, notesOpen)
const notes = computed(() => notesQuery.data.value ?? [])

// The history loads with the dossier — it is the answer to "when did we
// last meet", which is the question the dossier is opened to ask.
const sessionsQuery = useCoachPlayerSessionsQuery(() => props.player.id, true)
const sessions = computed(() => sessionsQuery.data.value ?? [])

// A sitting with no end is one the coach walked away from. Saying so beats
// showing a blank where a duration would go, and beats dropping the row —
// it happened, and how often the two of them meet is the point of the list.
function sessionLine(s: CoachSession): string {
  const covered = pluralize(s.match_keys.length, 'match', 'matches')
  return s.ended_at ? covered : `${covered} · never ended`
}

const subLine = computed(() => {
  const count = pluralize(props.player.note_count, 'note')
  const last = props.player.last_note_at ? ` · last note ${localDay(props.player.last_note_at)}` : ''
  return `${count}${last}`
})

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

    <template v-if="sessions.length">
      <p class="eyebrow ink">
        Sessions
      </p>
      <ul class="dossier-sessions" aria-label="Sessions">
        <li v-for="s in sessions" :key="s.session_id" class="dossier-session">
          <span class="dossier-session-when">{{ localDay(s.opened_at) }}</span>
          <span class="dossier-session-what">{{ sessionLine(s) }}</span>
          <span v-if="s.focus_items.length" class="dossier-session-focus">
            {{ s.focus_items.map((f) => f.text).join(' · ') }}
          </span>
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
            <span class="dossier-note-key">{{ matchKeyLabel(n.match_key) }}</span>
            <span v-if="n.match_clock" class="dossier-note-clock">at {{ n.match_clock }}</span>
            <span v-if="n.moment_count" class="dossier-note-clock">{{ n.moment_count }} moment{{ n.moment_count === 1 ? '' : 's' }}</span>
          </span>
          <p v-if="n.text || (n.kind === 'reviewed_only' && !n.moment_count)" class="dossier-note-text">
            {{ n.kind === 'reviewed_only' ? 'Reviewed — nothing to add.' : n.text }}
          </p>
          <span v-if="n.focus_tags.length" class="dossier-note-tags">{{ n.focus_tags.join(' · ') }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
/* The history reads as a column of dates with what each one covered — the
   shape of a logbook, which is what it is. */
.dossier-sessions {
  margin: 0 0 0.6rem;
  padding: 0;
  list-style: none;
}

.dossier-session {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  padding: 0.25rem 0;
  font-size: var(--type-2xs);
}

.dossier-session-when { font-family: var(--mono); }

.dossier-session-focus {
  flex-basis: 100%;
  opacity: 0.7;
}

.dossier {
  display: grid;

  /* The row is a wrapping flex line — without a full-width basis the
     panel shrink-wraps beside the door button instead of below it. */
  flex: 1 1 100%;
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
