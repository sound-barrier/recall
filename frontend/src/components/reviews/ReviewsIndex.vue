<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import FocusBand from '@/components/reviews/FocusBand.vue'
import ReviewLedgerRow from '@/components/reviews/ReviewLedgerRow.vue'
import SelfReviewCard from '@/components/reviews/SelfReviewCard.vue'
import { formatPlayerDay, localDay } from '@/match/coach/coach-time'
import { latestSessionKeys } from '@/match/dossier/match-momentum-helpers'
import { matchTime } from '@/match/match-time-helpers'
import {
  answeringCoach, focusLine, groupReceivedReviews, notesFromLine,
  received02Label, rosterLine, sentLine,
} from '@/match/reviews/reviews-helpers'
import { shelfCard } from '@/match/reviews/shelf-helpers'
import { useFocusQuery } from '@/queries/focus'
import { useCoachPlayersQuery, useShareExportsQuery } from '@/queries/selfReview'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { useCoachReturnsStore } from '@/stores/coachReturns'
import { useDatabaseStore } from '@/stores/database'
import { useMatchesStore } from '@/stores/matches'
import { useSelfReviewStore } from '@/stores/selfReview'
import { useUiStore } from '@/stores/ui'
import {
  NOTHING_TO_SEND_REASON, SESSION_SHARE_REASON, useWriteGate,
} from '@/composables/shared/useWriteGate'

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

const { writesLocked, lockedTitle, lockReason, sessionActive, guardWrite } = useWriteGate()

// Sending is a read, so the write gate is the wrong test — but during a
// session the matches on screen are the COACH'S loaned corpus, and a
// bundle of somebody else's matches signed with your handle is worse than
// a blocked write.
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
// Hidden matches were hidden on purpose — a quick start must not quietly
// sweep them back into a review.
const visibleRecords = computed(() => records.value.filter((r) => !r.hidden))
const sessionKeys = computed(() => latestSessionKeys(visibleRecords.value))
const lastNKeys = computed(() => [...visibleRecords.value]
  .sort((a, b) => matchTime(b).localeCompare(matchTime(a)))
  .slice(0, LAST_N_CAP)
  .map((r) => r.match_key))

function startOver(keys: readonly string[]): void {
  if (keys.length === 0 || !guardWrite()) return
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

// Memoized: the received list renders a card per sitting and each card asked
// for its sheet three times, so this was an O(n) find per lookup. The Map also
// makes the template's narrowing real — `sheetOf(r)` short-circuits where the
// old code needed a non-null assertion the checker could not verify.
const sheetBySitting = computed(() =>
  new Map(inbox.value.map(s => [`${s.coach_name}|${s.session_date}`, s])))
function sheetOf(r: { coachName: string; sessionDate: string }) {
  return sheetBySitting.value.get(`${r.coachName}|${r.sessionDate}`)
}

function openSheet(r: { coachName: string; sessionDate: string }): void {
  const sheet = sheetOf(r)
  if (sheet) void returns.openReturnSheet(sheet.id)
}

// The sent ledger: the receipt that a set left. A row pairs with the return
// that ANSWERS it — a sheet whose matches overlap the sent set — because the
// ledger records who signed the bundle (you), not who received it.
const sharesQuery = useShareExportsQuery(() => appStore.view === 'reviews')
// Same tab gate as the shelf: read when 07 is on screen, never at boot.
const focusQuery = useFocusQuery(() => appStore.view === 'reviews')
const focusEntries = computed(() => focusQuery.data.value ?? [])
const sentRows = computed(() => (sharesQuery.data.value ?? []).map((e) => ({
  ...e,
  answeredBy: answeringCoach(inbox.value, received.value, e),
})))

// Decided sheets none of whose notes landed — skipped, or removed since.
// They still happened; "No coach has looked yet" would be a lie.
const readOnlySheets = computed(() => {
  const carded = new Set(received.value.map((r) => `${r.coachName} ${r.sessionDate}`))
  return inbox.value.filter((s) => s.pending === 0 && !carded.has(`${s.coach_name} ${s.session_date}`))
})

const noCoachYet = computed(() =>
  waiting.value.length === 0 && received.value.length === 0 && readOnlySheets.value.length === 0)

// What the send button carries — the narrowed set, because that is exactly
// what it bundles.
const narrowedKeys = computed(() =>
  matches.matchesNarrow.narrowedRecords.value.map((r) => r.match_key))
const showingCount = computed(() => narrowedKeys.value.length)

function sendToCoach(): void {
  if (sessionActive.value) return
  matches.requestShare(narrowedKeys.value, 'narrow')
}

function openNotesFile(): void {
  void database.importMatches()
}

// The card's door: the matches the review touched, worn as one visible,
// clearable clause — never a silent filter reset under a deep link.
function showReviewMatches(r: { coachName: string; matchKeys: readonly string[] }): void {
  void matches.showOnlyMatches(r.matchKeys, `notes from ${r.coachName}`)
}

// ── 03 For someone else ────────────────────────────────────────────────
// The roster: notes persist between sessions keyed by player, and until
// this list the tab had no way to show that work ever happened.
const rosterQuery = useCoachPlayersQuery(() => appStore.view === 'reviews')
const roster = computed(() => rosterQuery.data.value ?? [])

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
      <ReviewLedgerRow v-for="sheet in waiting" :key="sheet.id">
        <template #eyebrow>
          <span class="eyebrow accent">Waiting</span>
        </template>
        {{ notesFromLine(sheet.pending, sheet.coach_name) }}
        <template #action>
          <button type="button" class="btn ghost" @click="returns.openReturnSheet(sheet.id)">
            Read the notes
          </button>
        </template>
      </ReviewLedgerRow>
    </ul>

    <!-- What you're working on, above the arc: the whole point of the
         cycle below is to produce this, and both halves of it feed here. -->
    <FocusBand :entries="focusEntries" :blocked-reason="lockReason" />

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
            :disabled="writesLocked || sessionKeys.length === 0"
            :title="writesLocked ? lockedTitle('Open a review over your last session') : (sessionKeys.length === 0 ? 'No matches yet — parse or add some first' : undefined)"
            @click="startOver(sessionKeys)"
          >
            Review my last session ({{ sessionKeys.length }})
          </button>
          <button
            v-if="lastNKeys.length > sessionKeys.length"
            type="button"
            class="btn"
            :disabled="writesLocked"
            :title="writesLocked ? lockedTitle('Open a review over your newest matches') : undefined"
            @click="startOver(lastNKeys)"
          >
            Review my last {{ lastNKeys.length }}
          </button>
          <button type="button" class="btn ghost" @click="pickMatches">
            Pick matches…
          </button>
          <!-- The same set "Review my last session" acts on, sent instead of
               reviewed — so the two quick-picks are provably the same matches. -->
          <button
            type="button"
            class="btn ghost"
            :disabled="sessionActive || sessionKeys.length === 0"
            :title="sessionActive ? SESSION_SHARE_REASON
              : (sessionKeys.length === 0 ? 'No matches yet — parse or add some first' : undefined)"
            @click="matches.requestShare(sessionKeys, 'last-session')"
          >
            Send my last session to a coach ({{ sessionKeys.length }})
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
              Send matches to a coach
            </h4>
            <p class="setting-desc">
              Sends the matches showing on Matches — narrow the list there to
              choose the set — as a file stamped with your name, for a coach
              to open in their own Recall. Their notes come back as a file
              you decide on, match by match.
            </p>
          </div>
          <div class="setting-control">
            <button
              type="button"
              class="btn ghost"
              :disabled="sessionActive || showingCount === 0"
              :title="sessionActive ? SESSION_SHARE_REASON
                : (showingCount === 0 ? NOTHING_TO_SEND_REASON : undefined)"
              @click="sendToCoach"
            >
              Send to a coach… ({{ showingCount }} showing on Matches)
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
        <ReviewLedgerRow v-for="e in sentRows" :key="e.id" quiet>
          {{ sentLine(e) }} —
          <template v-if="e.answeredBy">
            answered by {{ e.answeredBy }}.
          </template>
          <template v-else>
            nothing back yet.
          </template>
          <template #action>
            <button type="button" class="btn ghost" @click="matches.showOnlyMatches(e.match_keys, `matches you sent ${localDay(e.exported_at)}`)">
              Show these matches →
            </button>
          </template>
        </ReviewLedgerRow>
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
            <p v-if="focusLine(inbox, r)" class="review-card-summary">
              {{ focusLine(inbox, r) }}
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
                v-if="sheetOf(r)"
                type="button"
                class="paper-btn review-card-open"
                @click="openSheet(r)"
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
        <ReviewLedgerRow v-for="sheet in readOnlySheets" :key="sheet.id" quiet>
          {{ sheet.coach_name }} · {{ formatPlayerDay(sheet.session_date) }} — None of these
          notes are on your matches; you skipped or removed them.
          <template #action>
            <button type="button" class="btn ghost" @click="returns.openReturnSheet(sheet.id)">
              Read again
            </button>
          </template>
        </ReviewLedgerRow>
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
      <ul v-if="roster.length" class="reviews-waiting" aria-label="Players you have coached">
        <ReviewLedgerRow v-for="p in roster" :key="p.id" quiet>
          {{ rosterLine(p) }}<template v-if="p.focus_items?.length">
            — {{ p.focus_items.join(' · ') }}
          </template>
        </ReviewLedgerRow>
      </ul>
      <p v-if="roster.length" class="reviews-empty">
        Your notes stay with you, filed by player. Open their next bundle
        and the notes resurface — a second session builds on the first.
      </p>
      <p v-else class="reviews-empty">
        No one has sent you a bundle yet — when a player shares their
        matches with you, this is where you open them.
      </p>
    </div>
  </div>
</template>

<style scoped src="./reviews-index.css"></style>
