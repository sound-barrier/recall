<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import SelfReviewCard from '@/components/reviews/SelfReviewCard.vue'
import type { CoachReturnSheet, ShareExport } from '@/api-client'
import { formatPlayerDay } from '@/match/coach/coach-time'
import { latestSessionKeys } from '@/match/dossier/match-momentum-helpers'
import { matchTime } from '@/match/match-time-helpers'
import { groupReceivedReviews } from '@/match/reviews/reviews-helpers'
import { shelfCard } from '@/match/reviews/shelf-helpers'
import { useShareExportsQuery } from '@/queries/selfReview'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { useCoachReturnsStore } from '@/stores/coachReturns'
import { useDatabaseStore } from '@/stores/database'
import { useMatchesStore } from '@/stores/matches'
import { useSelfReviewStore } from '@/stores/selfReview'
import { useUiStore } from '@/stores/ui'

// The tab's front of house, where the reels come off and go back on.
//
// The room's metaphor is film editing: reel, desk, loan slip, frames,
// sprockets, a ledger. Three sections, numbered because they are an arc:
// the review cycle runs from YOU (01, your own reviews) to A COACH (02)
// to SOMEONE ELSE (03), and a new player meets them in that order. The one
// exception to the arc is anything WAITING on you — those rows float above
// it, because time-sensitive beats narrative.
//
// Every section carries its action whether or not it is empty, because the
// empty state IS the invitation — and each empty is its own sentence.
const appStore = useAppStore()
const coach = useCoachStore()
const returns = useCoachReturnsStore()
const database = useDatabaseStore()
const matches = useMatchesStore()
const ui = useUiStore()

const { inbox } = storeToRefs(returns)
const { records } = storeToRefs(matches)
const selfReview = useSelfReviewStore()
const { reviews: sittings } = storeToRefs(selfReview)

// ── 01 Your own reviews ────────────────────────────────────────────────
// The shelf: every sitting as a card, newest first (the store's order),
// drawn against the player's own records — and three ways to start one.
const shelfCards = computed(() => sittings.value.map((s) => shelfCard(s, records.value)))

// The quick starts. "Last session" is the trailing run of games closer than
// the session gap — last night's games as much as tonight's, which is why it
// is not called "today's". "Last N" is simply the newest N the history holds.
const LAST_N_CAP = 10
const sessionKeys = computed(() => latestSessionKeys(records.value))
const lastNKeys = computed(() => [...records.value]
  .sort((a, b) => matchTime(b).localeCompare(matchTime(a)))
  .slice(0, LAST_N_CAP)
  .map((r) => r.match_key))

function startOver(keys: readonly string[]): void {
  if (keys.length === 0) return
  void selfReview.createFromKeys([...keys])
}

function openSitting(reviewId: string): void {
  void selfReview.openSitting(reviewId)
}

function removeSitting(reviewId: string): void {
  void selfReview.remove(reviewId)
}

// "Pick matches…" walks to the list AND says what to do there — the
// checkbox it points at only appears on hover, so without the hint the
// trail goes cold on arrival.
function pickMatches(): void {
  ui.showReviewPickHint()
  void appStore.goToView('matches')
}

// ── 02 From a coach ────────────────────────────────────────────────────
// Waiting: sheets still holding an undecided note. Received: one coach's one
// sitting, reassembled from the blocks that landed — the app keeps no other
// record of a review it was given.
const waiting = computed(() => inbox.value.filter((s) => s.pending > 0))
const received = computed(() => groupReceivedReviews(records.value))

// The return sheet a received review came from, when it is still around —
// it carries the coach's summary (the one thing they wrote about the SET,
// which no block carries) and the way to read the notes again.
function sheetFor(r: { coachName: string; sessionDate: string }) {
  return inbox.value.find((s) => s.coach_name === r.coachName && s.session_date === r.sessionDate)
}

// The sent ledger: the receipt that a set left. A row pairs with the return
// that ANSWERS it — a sheet whose matches overlap the sent set — because the
// ledger records who signed the bundle (you), not who received it.
const sharesQuery = useShareExportsQuery(() => appStore.view === 'reviews')
const sentRows = computed(() => (sharesQuery.data.value ?? []).map((e) => ({
  ...e,
  answeredBy: answeringCoach(e),
})))

function answeringCoach(e: ShareExport): string {
  const sent = new Set(e.match_keys)
  const answer = inbox.value.find((sheet: CoachReturnSheet) =>
    sheet.imported_at > e.exported_at && sheet.notes.some((n) => sent.has(n.match_key)))
  return answer?.coach_name ?? ''
}

function sentLine(e: { match_keys: string[]; exported_at: string }): string {
  const n = e.match_keys.length
  return `Sent ${n} ${n === 1 ? 'match' : 'matches'} · ${formatPlayerDay(e.exported_at.slice(0, 10))}`
}

// Decided sheets none of whose notes landed — skipped, or removed since.
// They still happened; "No coach has looked yet" would be a lie.
const readOnlySheets = computed(() => {
  const carded = new Set(received.value.map((r) => `${r.coachName} ${r.sessionDate}`))
  return inbox.value.filter((s) => s.pending === 0 && !carded.has(`${s.coach_name} ${s.session_date}`))
})

const noCoachYet = computed(() =>
  waiting.value.length === 0 && received.value.length === 0 && readOnlySheets.value.length === 0)

// The count the share button carries — the narrowed set, because that is
// exactly what sharing bundles.
const showingCount = computed(() => matches.matchesNarrow.narrowedRecords.value.length)

function notesFromLine(count: number, coachName: string): string {
  return `${count} note${count === 1 ? '' : 's'} from ${coachName}`
}

function shareWithCoach(): void {
  void matches.shareNarrowedWithCoach()
}

function openNotesFile(): void {
  void database.importMatches()
}

// The card's door: the matches the review touched, worn as one visible,
// clearable clause — never a silent filter reset under a deep link.
function showReviewMatches(r: { coachName: string; matchKeys: readonly string[] }): void {
  void matches.showOnlyMatches(r.matchKeys, `notes from ${r.coachName}`)
}

function received02Label(r: { sessionDate: string; noteCount: number; matchKeys: readonly string[] }): string {
  const notes = `${r.noteCount} ${r.noteCount === 1 ? 'note' : 'notes'}`
  const matchCount = `${r.matchKeys.length} ${r.matchKeys.length === 1 ? 'match' : 'matches'}`
  return `${formatPlayerDay(r.sessionDate)} · ${notes} · ${matchCount}`
}

// ── 03 For someone else ────────────────────────────────────────────────
function openBundle(): void {
  void coach.openBundle()
}
</script>

<template>
  <div class="reviews-index">
    <header class="settings-intro">
      <h2 class="settings-heading">
        Your reviews
      </h2>
      <p class="reviews-desc">
        The ones you write about your own matches, the ones a coach sends
        back, and the ones you give someone else.
      </p>
    </header>

    <!-- Waiting on a decision, one row per sheet — above everything,
         because it is the one time-sensitive thing here. The app-chrome
         inbox banner steps aside on this tab (App.vue) — these rows ARE
         the banner here, in its shape, per coach instead of summed. -->
    <ul v-if="waiting.length" class="reviews-waiting" aria-label="Notes waiting on a decision">
      <li v-for="sheet in waiting" :key="sheet.id" class="reviews-waiting-row">
        <span class="eyebrow accent">Waiting</span>
        <span class="reviews-waiting-line">{{ notesFromLine(sheet.pending, sheet.coach_name) }}</span>
        <button type="button" class="btn ghost" @click="returns.openReturnSheet(sheet.id)">
          Read the notes
        </button>
      </li>
    </ul>

    <!-- 01 / YOUR OWN REVIEWS -->
    <div id="sec-your-own-reviews" class="settings-section">
      <div class="section-header">
        <span class="section-num">01</span>
        <span class="section-slash" aria-hidden="true">/</span>
        <h3 class="section-title">
          Your own reviews
        </h3>
      </div>

      <div class="reviews-start">
        <h4 class="setting-label">
          Review some matches
        </h4>
        <p class="setting-desc">
          The film room opens over them, in your own clock, with a note and a
          moments strip for each. Every note lands on its match as you write
          it; Finish marks the matches reviewed and keeps the review here.
        </p>
        <div class="reviews-start-actions">
          <button
            type="button"
            class="btn primary"
            :disabled="sessionKeys.length === 0"
            :title="sessionKeys.length === 0 ? 'No matches yet — parse or add some first' : undefined"
            @click="startOver(sessionKeys)"
          >
            Review my last session ({{ sessionKeys.length }})
          </button>
          <button
            v-if="lastNKeys.length > sessionKeys.length"
            type="button"
            class="btn"
            @click="startOver(lastNKeys)"
          >
            Review my last {{ lastNKeys.length }}
          </button>
          <button type="button" class="btn ghost" @click="pickMatches">
            Pick matches…
          </button>
        </div>
      </div>

      <ul v-if="shelfCards.length" class="reviews-shelf" aria-label="Your own reviews">
        <li v-for="card in shelfCards" :key="card.reviewId">
          <SelfReviewCard
            :card="card"
            @open="openSitting(card.reviewId)"
            @remove="removeSitting(card.reviewId)"
            @show-matches="matches.showOnlyMatches(card.matchKeys, `review “${card.title}”`)"
          />
        </li>
      </ul>
      <p v-else class="reviews-empty">
        Nothing reviewed yet — start with your last session, or pick the
        matches yourself.
      </p>
    </div>

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
              Share matches with a coach
            </h4>
            <p class="setting-desc">
              Sends the matches showing on Matches — narrow the list there to
              choose the set — as a file stamped with your name, for a coach
              to open in their own Recall. Their notes come back as a file
              you decide on, match by match.
            </p>
          </div>
          <div class="setting-control">
            <button type="button" class="btn ghost" @click="shareWithCoach">
              Share with a coach… ({{ showingCount }} showing on Matches)
            </button>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <h4 class="setting-label">
              Open a notes file
            </h4>
            <p class="setting-desc">
              The other way notes arrive: a coach hands you the file their
              session saved, and opening it lands each note on your matches.
            </p>
          </div>
          <div class="setting-control">
            <button type="button" class="btn ghost" @click="openNotesFile">
              Open a notes file…
            </button>
          </div>
        </div>
      </div>

      <!-- The sent ledger: what left, when, and whether anything came back.
           Quiet rows — a receipt, not a task. -->
      <ul v-if="sentRows.length" class="reviews-waiting" aria-label="Matches you have sent out">
        <li v-for="e in sentRows" :key="e.id" class="reviews-waiting-row reviews-skipped-row">
          <span class="reviews-waiting-line">
            {{ sentLine(e) }} —
            <template v-if="e.answeredBy">answered by {{ e.answeredBy }}.</template>
            <template v-else>nothing back yet.</template>
          </span>
          <button type="button" class="btn ghost" @click="matches.showOnlyMatches(e.match_keys, `matches you sent ${formatPlayerDay(e.exported_at.slice(0, 10))}`)">
            Show these matches →
          </button>
        </li>
      </ul>

      <!-- Received: on paper, because a review is written on paper. -->
      <ul v-if="received.length" class="reviews-shelf" aria-label="Reviews you have received">
        <li v-for="(r, i) in received" :key="`${r.coachName} ${r.sessionDate}`">
          <article class="paper review-card" :aria-labelledby="`review-card-head-${i}`">
            <h4 :id="`review-card-head-${i}`" class="review-card-coach paper-rule-hatch">
              {{ r.coachName }}
            </h4>
            <p class="eyebrow ink review-card-line">
              {{ received02Label(r) }}
            </p>
            <p v-if="sheetFor(r)?.summary" class="review-card-summary">
              {{ sheetFor(r)?.summary }}
            </p>
            <div class="review-card-actions">
              <button
                type="button"
                class="paper-btn review-card-open"
                @click="showReviewMatches(r)"
              >
                Show these matches →
              </button>
              <button
                v-if="sheetFor(r)"
                type="button"
                class="paper-btn review-card-open"
                @click="returns.openReturnSheet(sheetFor(r)!.id)"
              >
                Read the notes again
              </button>
            </div>
          </article>
        </li>
      </ul>

      <!-- Reviews that landed nowhere — every note skipped, or removed
           since. Quiet rows, not cards: there is nothing on any match to
           show, but the review still happened. -->
      <ul v-if="readOnlySheets.length" class="reviews-waiting" aria-label="Reviews with nothing kept">
        <li v-for="sheet in readOnlySheets" :key="sheet.id" class="reviews-waiting-row reviews-skipped-row">
          <span class="reviews-waiting-line">
            {{ sheet.coach_name }} · {{ formatPlayerDay(sheet.session_date) }} — None of these
            notes are on your matches; you skipped or removed them.
          </span>
          <button type="button" class="btn ghost" @click="returns.openReturnSheet(sheet.id)">
            Read again
          </button>
        </li>
      </ul>

      <!-- The actions are the rows above; this only says what the
           emptiness means. -->
      <p v-if="noCoachYet" class="reviews-empty">
        No coach has looked yet — share some matches, or open a notes file
        you were given.
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
              A bundle — the .zip of matches a player shares from their own
              Reviews tab — opens here as a coaching session. Their matches
              are loaned, never added to your history; your notes travel
              back as a file they decide on. Notes are signed with your
              coach name, set in Settings.
            </p>
          </div>
          <div class="setting-control">
            <button
              type="button"
              class="btn ghost"
              :disabled="coach.tourOpen"
              :title="coach.tourOpen ? 'Finish the walkthrough before opening a player\'s bundle.' : undefined"
              @click="openBundle"
            >
              Open a player's bundle…
            </button>
          </div>
        </div>
      </div>
      <p class="reviews-empty">
        No one has sent you a bundle yet — when a player shares their
        matches with you, this is where you open them.
      </p>
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
  margin: 1.2rem 0 0;
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

/* The start block: 01's call to action, not a preference row — the page's
   primary verb lives here, so it reads as a block with its buttons under
   the sentence, not a label with a control across the page. */
.reviews-start {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 62ch;
}

.reviews-start .setting-desc {
  margin: 0;
}

.reviews-start-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.35rem;
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

/* The card is named by the coach, in the display voice — the tallies are
   the label line under it, not the title. The hatch strip stays: one
   strip, one meaning, "this is a sitting". */
.review-card-coach {
  margin: 0;
  padding: 0.5rem 0.75rem;
  font-family: var(--display);
  font-size: var(--type-3xl);
  font-style: italic;
  font-weight: 800;
  line-height: 1.1;
  text-transform: uppercase;
  border-bottom: 1px solid var(--paper-edge);
}

.review-card-line {
  margin: 0 0.75rem;
}

.review-card-summary {
  margin: 0 0.75rem;
  font-size: var(--type-lg);
  line-height: 1.45;
  color: var(--ink);
}

.review-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0 0.75rem 0.75rem;
}

.review-card-open {
  align-self: flex-start;
}

/* A review with nothing kept is history, not a task — no accent stripe. */
.reviews-skipped-row {
  border-left-color: var(--border);
}

.reviews-empty {
  margin: 1rem 0 0;
  font-size: var(--type-lg);
  line-height: 1.5;
  color: var(--text-faint);
}
</style>
