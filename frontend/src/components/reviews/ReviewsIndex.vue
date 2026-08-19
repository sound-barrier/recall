<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import { formatPlayerDay } from '@/match/coach/coach-time'
import { groupReceivedReviews } from '@/match/reviews/reviews-helpers'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { useCoachReturnsStore } from '@/stores/coachReturns'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'

// The shelf — every review, labeled, and the next one a click away.
//
// The room's metaphor is film editing: reel, desk, loan slip, frames,
// sprockets, a ledger. This is the room's front of house, where the reels
// come off and go back on. Three sections, numbered because they are an
// arc: the review cycle runs from YOU (01, your own reviews — lands with
// self-review) to A COACH (02) to SOMEONE ELSE (03), and a new player meets
// them in that order.
//
// Every section carries its action whether or not it is empty, because the
// empty state IS the invitation — and each empty is its own sentence.
const appStore = useAppStore()
const coach = useCoachStore()
const returns = useCoachReturnsStore()
const matches = useMatchesStore()
const ui = useUiStore()

const { inbox } = storeToRefs(returns)
const { records } = storeToRefs(matches)

// ── 02 From a coach ────────────────────────────────────────────────────
// Waiting: sheets still holding an undecided note. Received: one coach's one
// sitting, reassembled from the blocks that landed — the app keeps no other
// record of a review it was given.
const waiting = computed(() => inbox.value.filter((s) => s.pending > 0))
const received = computed(() => groupReceivedReviews(records.value))
const noCoachYet = computed(() => waiting.value.length === 0 && received.value.length === 0)

function notesFromLine(count: number, coachName: string): string {
  return `${count} note${count === 1 ? '' : 's'} from ${coachName}`
}

function sendMatchesOut(): void {
  void matches.shareNarrowedWithCoach()
}

// A received review has no room of its own (a third room mode, not built);
// the card takes you to the first match it touched, in the detail panel.
// The first match the narrow can show, that is: a review is grouped from
// EVERY record, and the panel only opens over the narrowed set, so a member
// the current narrow excludes is skipped — and if none is in the narrow, the
// narrow is widened for the first (see `revealMatch`) rather than opening a
// panel with nothing behind it.
async function openReceived(matchKeys: readonly string[]): Promise<void> {
  await appStore.goToView('matches')
  const inNarrow = new Set(matches.matchesNarrow.narrowedRecords.value.map((r) => r.match_key))
  const target = matchKeys.find((k) => inNarrow.has(k)) ?? matchKeys[0]
  if (target !== undefined) ui.revealMatch(target)
}

// ── 03 For someone else ────────────────────────────────────────────────
function openBundle(): void {
  void coach.openBundle()
}
</script>

<template>
  <div class="reviews-index">
    <header class="settings-intro">
      <p class="eyebrow settings-eyebrow">
        Review cycle
      </p>
      <h2 class="settings-heading">
        Who has looked at your games
      </h2>
      <p class="reviews-desc">
        Review your own matches the way a coach would, send some out, read
        what comes back — or coach someone else. Every review you give or
        get lives here.
      </p>
    </header>

    <!-- 02 / FROM A COACH -->
    <div id="sec-from-a-coach" class="settings-section">
      <div class="section-header">
        <span class="section-num">02</span>
        <span class="section-slash" aria-hidden="true">/</span>
        <h3 class="section-title">
          From a coach
        </h3>
      </div>
      <div class="setting-rows">
        <div class="setting-row">
          <div class="setting-info">
            <h4 class="setting-label">
              Send matches out
            </h4>
            <p class="setting-desc">
              Takes you to Matches and bundles the set showing there, stamped
              with your name, for a coach to open in their own Recall. Their
              notes come back as a file you decide on, match by match.
            </p>
          </div>
          <div class="setting-control">
            <button type="button" class="btn ghost" @click="sendMatchesOut">
              Send matches out…
            </button>
          </div>
        </div>
      </div>

      <!-- Waiting on a decision, one row per sheet. The app-chrome inbox
           banner steps aside on this tab (App.vue) — these rows ARE the
           banner here, in its shape, per coach instead of summed. -->
      <ul v-if="waiting.length" class="reviews-waiting" aria-label="Notes waiting on a decision">
        <li v-for="sheet in waiting" :key="sheet.id" class="reviews-waiting-row">
          <span class="eyebrow accent">Waiting</span>
          <span class="reviews-waiting-line">{{ notesFromLine(sheet.pending, sheet.coach_name) }}</span>
          <button type="button" class="btn ghost" @click="returns.openReturnSheet(sheet.id)">
            Review
          </button>
        </li>
      </ul>

      <!-- Received: on paper, because a review is written on paper. -->
      <ul v-if="received.length" class="reviews-shelf" aria-label="Reviews you have received">
        <li v-for="(r, i) in received" :key="`${r.coachName} ${r.sessionDate}`">
          <!-- The card is named by its own heading — one string in the a11y
               tree and on the paper, so they cannot disagree. -->
          <article class="paper review-card" :aria-labelledby="`review-card-head-${i}`">
            <h4 :id="`review-card-head-${i}`" class="eyebrow ink review-card-head paper-rule-hatch">
              {{ r.coachName }} · {{ formatPlayerDay(r.sessionDate) }} ·
              {{ r.noteCount }} {{ r.noteCount === 1 ? 'note' : 'notes' }} ·
              {{ r.matchKeys.length }} {{ r.matchKeys.length === 1 ? 'match' : 'matches' }}
            </h4>
            <button
              type="button"
              class="paper-btn review-card-open"
              @click="openReceived(r.matchKeys)"
            >
              Open the first match →
            </button>
          </article>
        </li>
      </ul>

      <!-- The action is the row above; this only says what the emptiness
           means and names the other way in. Two identical buttons in one
           section would be one too many. -->
      <p v-if="noCoachYet" class="reviews-empty">
        No coach has looked yet — send some matches out, or import a notes
        file you were given from the Matches toolbar.
      </p>
    </div>

    <!-- 03 / FOR SOMEONE ELSE -->
    <div id="sec-for-someone-else" class="settings-section">
      <div class="section-header">
        <span class="section-num">03</span>
        <span class="section-slash" aria-hidden="true">/</span>
        <h3 class="section-title">
          For someone else
        </h3>
      </div>
      <div class="setting-rows">
        <div class="setting-row">
          <div class="setting-info">
            <h4 class="setting-label">
              Open a player's bundle
            </h4>
            <p class="setting-desc">
              A bundle a player shared with you opens here as a coaching session.
              Their matches are loaned, never added to your history; your notes
              travel back as a file they decide on.
            </p>
          </div>
          <div class="setting-control">
            <button type="button" class="btn ghost" @click="openBundle">
              Open a player's bundle…
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The description under the heading. --text-dim rather than --text-mute:
   this is the paragraph that says what the tab is for, and --text-mute
   drops below AA on Day's darker surfaces. */
.reviews-desc {
  max-width: 62ch;
  margin: 0;
  font-size: var(--type-lg);
  line-height: 1.55;
  color: var(--text-dim);
}

.reviews-waiting {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}

/* The house banner shape — surface fill, an accent stripe down the left —
   token for token the one the app-chrome inbox banner wears
   (CoachInboxBanner.vue), so a player recognizes the row here as the
   banner they saw on the other tabs. */
.reviews-waiting-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
  padding: 0.5rem 0.75rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
}

.reviews-waiting-line {
  flex: 1 1 auto;
  font-size: var(--type-lg);
  color: var(--text);
}

/* The shelf: reviews as paper cards in a responsive row. */
.reviews-shelf {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: 0.9rem;
  margin: 1.2rem 0 0;
  padding: 0;
  list-style: none;
}

.review-card {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0;
  overflow: hidden;
}

/* The card's label is the ruled-paper hatch the reel's day labels and the
   session rule already wear — one strip, one meaning: "this is a sitting". */
.review-card-head {
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--paper-edge);
}

.review-card-open {
  align-self: flex-start;
  margin: 0 0.75rem 0.75rem;
}

.reviews-empty {
  margin: 1rem 0 0;
  font-size: var(--type-lg);
  line-height: 1.5;
  color: var(--text-faint);
}
</style>
