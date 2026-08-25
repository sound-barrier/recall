<script setup lang="ts">
import { computed } from 'vue'

import { formatLocalFromUTC, playerClockOwner } from '@/match/match-time-helpers'
import { noteMark } from '@/match/coach/coach-notes'
import { useCoachStore } from '@/stores/coach'

// The loan slip — the masthead while a coaching session is open.
//
// It takes the profile chip's place because it answers the same question:
// whose data is on screen. Everything else on it is the loan's terms — how
// much was lent, when it was exported, that none of it is being kept, and
// the two ways the session can end (with the notes, or without them).

const coach = useCoachStore()

// A plain export names nobody, so the slip has a blank where the handle
// goes until the room's "Who is this?" prompt is answered. Saying so is
// better than a masthead that reads "reviewing" and then stops.
const handle = computed(() =>
  (coach.needsPlayerHandle ? playerClockOwner('') : coach.player?.handle ?? ''))
// A team session speaks team: the eyebrow says so, the corpus is replays,
// and the per-player notes FILE has no addressee — the page leads alone.
const isTeam = computed(() => coach.player?.kind === 'team')
const label = computed(() => `Coaching session: reviewing ${handle.value}`)

// The export date is the PLAYER's — "exported Aug 22" alone read as the
// coach's own export status, one line above buttons that do that export.
const loanLine = computed(() => {
  const count = coach.session?.match_count ?? 0
  const exported = formatLocalFromUTC(coach.session?.exported_at)
  const matches = isTeam.value
    ? `${count} replay${count === 1 ? '' : 's'}`
    : `${count} match${count === 1 ? '' : 'es'}`
  return exported ? `${matches} · ${handle.value} exported ${exported}` : matches
})

// Marks, not drafts: a half-typed note that says nothing yet isn't a note.
const noteCount = computed(() =>
  Object.values(coach.notes).filter(draft => noteMark(draft) !== null).length)
const notesLine = computed(() => `Notes · ${noteCount.value}`)

// The store owns both refusals — an unsigned archive and one that would be
// missing a note whose save never landed.
const canExport = computed(() => coach.canExportNotes)
const exportTitle = computed(() =>
  canExport.value ? 'Save the notes file for the player' : coach.exportBlockedReason)

// Ending discards the loan. The notes themselves are saved server-side, but
// the ARCHIVE the player receives only exists once it has been exported —
// so unexported work earns a second question rather than a silent goodbye.
// The arming lives in the store: the session sheet has an End button too, and
// which one a coach happened to click used to decide whether unexported work
// was protected.
const endArmed = computed(() => coach.endArmed)
const requestEnd = () => coach.requestEndSession()
</script>

<template>
  <section class="paper coach-slip" :aria-label="label">
    <p class="eyebrow ink coach-slip-eyebrow">
      {{ isTeam ? 'Coaching session · team' : 'Coaching session' }}
    </p>
    <p class="coach-slip-handle">
      {{ handle }}
    </p>
    <p class="coach-slip-line">
      {{ loanLine }}
    </p>
    <p class="coach-slip-promise">
      These matches are on loan — nothing here joins your history.
    </p>
    <!--
      Design rule 12: the coach's own narrow describes THEIR corpus, so a
      session puts it aside and End hands it back. Correct, and it happened in
      complete silence — a coach who had deliberately filtered their history
      found the filters gone and no reason given, which reads as the app
      having lost them rather than held them.
    -->
    <p v-if="coach.narrowSetAside" class="coach-slip-line">
      Your own filters are set aside until this session ends.
    </p>
    <p class="coach-slip-line">
      {{ notesLine }}
    </p>
    <div class="coach-slip-actions">
      <button
        v-if="!isTeam"
        type="button"
        class="paper-btn coach-slip-btn"
        :disabled="!canExport"
        :title="exportTitle"
        @click="coach.exportNotes()"
      >
        1 · Export notes file — for their Recall
      </button>
      <!--
        The other way to hand it over. The archive is for a player who runs
        Recall and will import it; this is one page they can open in any
        browser, offline — for the player who will not, or does not have it.
        Same document either way: the archive's human copy IS this page.
      -->
      <button
        type="button"
        class="paper-btn coach-slip-btn"
        :disabled="!canExport"
        :title="exportTitle"
        @click="coach.exportSheet()"
      >
        {{ isTeam ? 'Save a web page — for the team' : 'Save a web page — read-only' }}
      </button>
      <!--
        The receipt: the export used to succeed in silence, on the one action
        in the room whose whole point is producing a file for someone else.
      -->
      <p v-if="coach.exportedTo" class="coach-slip-receipt" role="status">
        Notes saved to {{ coach.exportedTo }}.
      </p>
      <!-- The reason in visible text: a hover title reaches nobody on a
           keyboard, and the likeliest coach here is a first-time user. -->
      <p v-if="!canExport" class="coach-slip-blocked">
        {{ coach.exportBlockedReason }}
      </p>

      <button
        v-if="!endArmed"
        type="button"
        class="paper-btn coach-slip-btn"
        title="Discard the loaned records and go back to your own history"
        @click="requestEnd"
      >
        {{ isTeam ? 'End session' : '2 · End session' }}
      </button>
      <!--
        The armed state offers both answers. It used to replace the button in
        place with no way back: the only escape from "End anyway" was to not
        click it, and nothing disarmed it.
      -->
      <template v-else>
        <button
          type="button"
          class="paper-btn primary coach-slip-btn"
          :title="coach.endArmedTitle"
          @click="requestEnd"
        >
          {{ coach.endArmedLabel }}
        </button>
        <button
          type="button"
          class="paper-btn coach-slip-btn"
          @click="coach.cancelEndSession()"
        >
          Keep working
        </button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.coach-slip {
  display: grid;
  gap: 0.15rem;
  padding: 0.55rem 0.75rem;
  min-width: 15rem;
  text-align: left;
}

.coach-slip-eyebrow {
  margin: 0 0 0.1rem;
}

.coach-slip-handle {
  margin: 0;
  font-family: var(--display);
  font-size: var(--type-5xl);
  line-height: 1.1;
  color: var(--ink);
}

/* The export receipt. --win, because it reports something that worked. */
.coach-slip-receipt {
  margin: 0;
  font-size: var(--type-3xs);
  color: var(--win);
}

.coach-slip-blocked {
  margin: 0;
  font-size: var(--type-3xs);
  line-height: 1.4;
  color: var(--ink-dim);
}

.coach-slip-line {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--type-3xs);
  letter-spacing: 0.06em;
  color: var(--ink-dim);
}

.coach-slip-promise {
  margin: 0.15rem 0;
  font-family: var(--body);
  font-size: var(--type-2xs);
  font-style: italic;
  color: var(--ink-faint);
}

.coach-slip-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.35rem;
}

.coach-slip-btn {
  padding: 0.3rem 0.55rem;
  font-size: var(--type-3xs);
  letter-spacing: 0.1em;
}
</style>
