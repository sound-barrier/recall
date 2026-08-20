<script setup lang="ts">
// The app masthead: brand/repo link, the primary tablist, the parse chip,
// the W/L/D scoreboard, profile switcher, and the version + update-check
// control. Reads its state from the stores (view/version/update-check from app,
// records/parse/narrow from matches) and owns its own tablist keyboard-nav +
// the narrowed-set scoreboard tally — App just mounts `<AppMasthead />`.
import { computed, defineAsyncComponent } from 'vue'
import { storeToRefs } from 'pinia'

import { OpenURL } from '@/api-client'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { useSelfReviewStore } from '@/stores/selfReview'
import WhatsNewStrip from '@/components/app/WhatsNewStrip.vue'
import { useCoachReturnsStore } from '@/stores/coachReturns'
import { useMatchesStore } from '@/stores/matches'
import { useParseStore } from '@/stores/parse'
import { useSettingsStore } from '@/stores/settings'
import { tallyWLD } from '@/match/match-stats-helpers'
import { winrateOrNull } from '@/match/dossier/match-dossier-tally'
import { TABS, useTabKeyboardNav } from '@/composables/shared/keyboard/useTabKeyboardNav'
import { GITHUB_REPO_URL } from '@/app-links'
import MastheadParseChip from '@/components/app/masthead/MastheadParseChip.vue'
import MastheadWatchDot from '@/components/app/masthead/MastheadWatchDot.vue'
import ProfileSwitcher from '@/components/app/masthead/ProfileSwitcher.vue'
import AppMenuButton from '@/components/app/AppMenuButton.vue'
import CoachSessionRule from '@/components/coach/room/CoachSessionRule.vue'

// The session chrome is bytes nobody pays for outside a session: the slip
// and the nav strip are their own chunks, fetched when a bundle opens. The
// rule is a bare hatched <div> — its own chunk would cost more than it
// weighs.
const CoachLoanSlip = defineAsyncComponent(() => import('@/components/coach/room/CoachLoanSlip.vue'))
const CoachNavStrip = defineAsyncComponent(() => import('@/components/coach/room/CoachNavStrip.vue'))

const appStore = useAppStore()
const matchesStore = useMatchesStore()
const { view, appVersion } = storeToRefs(appStore)
const { goToView } = appStore
const { records, unknownRecords } = storeToRefs(matchesStore)
const { parseProgress, watchActivity, recordsPulse } = storeToRefs(useParseStore())
const { watchEnabled } = storeToRefs(useSettingsStore())
const { matchesNarrow } = matchesStore

// Tablist Arrow/Home/End nav — owned here (App keeps useAppKeyboard for the
// global registry + skip-link). The handler factory installs no document
// listener, so a second instance is free.
const { onTabKeydown } = useTabKeyboardNav(view, goToView)

// While a session is open the chrome changes hands: the slip answers
// "whose data is this" in the switcher's place, and the scoreboard goes
// with it (it tallies the loaned set, which the room's own sheet reports
// far better). The watch dot, parse chip, version and menu all stay —
// they are about the coach's own app, which keeps running underneath.
const coach = useCoachStore()
const sessionActive = computed(() => coach.sessionActive)

// The player's open sitting, when they have stepped off its tab — the strip
// below carries the way back (its own component decides the wording).
const selfReviewStore = useSelfReviewStore()
const sittingAway = computed(() => selfReviewStore.roomOpen && view.value !== 'reviews')

// Two tabs carry a suffix beside their label, and both are counts of work
// waiting: Unknown's unresolved records, and Reviews' coach notes waiting on
// a decision. Matches carries a dot instead (filters active, a state rather
// than a count). Rendered from the descriptor list so the tab SET is one
// definition — TAB_ORDER — and a tab that exists there cannot be missing
// here.
const pendingReviewNotes = computed(() => useCoachReturnsStore().pendingNoteCount)
// A count on a tab means something different per tab — unresolved
// screenshots on Unknown, coach notes waiting on a decision on Reviews — so
// each carries the word for it, visually hidden, in the tab's name.
const tabBadge = computed<Partial<Record<string, { count: number; unit: string }>>>(() => ({
  unknown: { count: unknownRecords.value.length, unit: 'unresolved' },
  reviews: { count: pendingReviewNotes.value, unit: 'notes waiting' },
}))

const activeFilterCount = matchesNarrow.activeClauseCount
// W/L/D across the currently-narrowed set — same source + leaver rule the
// MatchesView dossier's Record KPI tile uses, so the two stay in lockstep.
const wld = computed(() => tallyWLD(
  matchesNarrow.narrowedRecords.value,
  matchesNarrow.leaverHandling.value === 'exclude-tally',
))

// Decisive games only — the house convention, because a draw is not a loss.
// Null rather than 0 when nothing was decided: an all-draws set has no rate
// to report, and 0% would read as "you lost every game".
const winRate = computed(() => winrateOrNull(wld.value.w, wld.value.w + wld.value.l))
</script>

<template>
  <header class="masthead">
    <div class="masthead-left">
      <!-- Brandmark also acts as the repo link. Use <a> so the
           markup is semantically navigational (and middle-/right-
           click "open in new tab" work in server mode), but route
           left-clicks through OpenURL so Wails mode hits the OS
           browser instead of the embedded WebView. -->
      <a
        class="brandmark-tile brandmark-link"
        :href="GITHUB_REPO_URL"
        target="_blank"
        rel="noopener noreferrer"
        :title="`Open Recall on GitHub — ${GITHUB_REPO_URL}`"
        aria-label="Open the Recall project on GitHub"
        @click.prevent="OpenURL(GITHUB_REPO_URL)"
      >
        <span class="brand-tick">↺</span>
        <h1 class="brand">
          RE<span class="brand-accent">CALL</span>
        </h1>
        <span class="brand-corner" aria-hidden="true" />
        <span class="brand-extlink" aria-hidden="true">↗</span>
      </a>
      <p class="tagline">
        Personal Telemetry · Match Almanac
      </p>
      <!-- Workflow order: configure → ingest → view → triage. Matches
           stays the default landing tab even though it sits at position
           03 — the numbering communicates the intended user flow. -->
      <nav class="page-nav" role="tablist" aria-label="Primary" @keydown="onTabKeydown">
        <button
          v-for="tab in TABS"
          :id="`tab-${tab.id}`"
          :key="tab.id"
          class="nav-tab"
          :class="{ active: view === tab.id }"
          :aria-selected="view === tab.id"
          :aria-current="view === tab.id ? 'page' : undefined"
          :tabindex="view === tab.id ? 0 : -1"
          role="tab"
          :aria-controls="`panel-${tab.id}`"
          @click="goToView(tab.id)"
        >
          <span class="nav-tab-num" aria-hidden="true">{{ tab.number }}</span>
          <span class="nav-tab-label">
            {{ tab.label }}
            <span
              v-if="tab.id === 'matches' && activeFilterCount > 0 && view !== 'matches'"
              class="nav-tab-filter-dot"
              :title="`${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`"
              aria-label="filters active"
            />
            <!-- The unit's leading space is an interpolation on purpose: a
                 literal " " there is a whitespace-only first child, which the
                 template compiler condenses away, and the name would read
                 "Reviews 3notes waiting". -->
            <span v-if="(tabBadge[tab.id]?.count ?? 0) > 0" class="nav-tab-badge">
              {{ tabBadge[tab.id]?.count }}<span class="sr-only">{{ ' ' }}{{ tabBadge[tab.id]?.unit }}</span>
            </span>
          </span>
        </button>
      </nav>
    </div>
    <div class="masthead-right">
      <MastheadWatchDot
        :watch-enabled="watchEnabled"
        :activity="watchActivity"
        :parse-progress="parseProgress"
      />
      <MastheadParseChip
        :parse-progress="parseProgress"
        @go-to-view="goToView($event)"
      />
      <CoachLoanSlip v-if="sessionActive" />
      <div
        v-if="!sessionActive && records.length > 0 && view === 'matches'"
        class="scoreboard"
        :class="{ pulse: recordsPulse }"
        role="group"
        aria-label="Record"
        title="Wins · Losses · Draws across the currently filtered matches, and the win rate over decisive games"
      >
        <div class="score-cell">
          <span class="score-num win">{{ wld.w }}</span>
          <span class="score-label">Won</span>
        </div>
        <div class="score-cell">
          <span class="score-num loss">{{ wld.l }}</span>
          <span class="score-label">Lost</span>
        </div>
        <div class="score-cell">
          <span class="score-num draw">{{ wld.d }}</span>
          <span class="score-label">Drew</span>
        </div>
        <p class="score-rate">
          <span class="score-rate-num">{{ winRate === null ? '—' : `${winRate}%` }}</span>
          <span class="score-label">Win rate</span>
        </p>
      </div>
      <ProfileSwitcher v-if="!sessionActive" />
      <div class="ver-block">
        <span v-if="appVersion" class="app-version">v{{ appVersion }}</span>
      </div>
      <!-- ⋮ application menu (About / Settings / Help). Renders only off
           macOS-Wails — macOS uses the native menu bar (pkg/cmd/wails.go);
           the version + update check live in About now. -->
      <AppMenuButton />
    </div>
  </header>

  <!-- Session chrome, on EVERY view: the hatched rule says the whole page
       is on loan, and the strip is the way between the room and the six
       tabs running on the player's data. Both sit outside <header> so the
       masthead's own layout is untouched. -->
  <template v-if="sessionActive">
    <CoachSessionRule />
    <CoachNavStrip />
  </template>
  <!-- The sitting's lighter bridge: no loan rule (nothing is on loan), just
       the way back, and only while the player is away from its tab. -->
  <CoachNavStrip v-else-if="sittingAway" />
  <!-- The one-time feature pointer, for installs that predate the tab. Kept
       out of a session's chrome — a loan is not the moment. -->
  <WhatsNewStrip v-if="!sessionActive" />
</template>
