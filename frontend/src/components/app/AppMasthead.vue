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
import { useMatchesStore } from '@/stores/matches'
import { useParseStore } from '@/stores/parse'
import { useSettingsStore } from '@/stores/settings'
import { tallyWLD } from '@/match/match-stats-helpers'
import { winrateOrNull } from '@/match/dossier/match-dossier-tally'
import { useTabKeyboardNav } from '@/composables/shared/keyboard/useTabKeyboardNav'
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

// The film room is a view with no tab, so no tab is selected while it is
// up. One tab must still be reachable by Tab (the roving-tabindex rule),
// and Matches is where the back affordance lands you.
const rovingTab = computed(() => (view.value === 'coach' ? 'matches' : view.value))

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
          id="tab-settings"
          class="nav-tab"
          :class="{ active: view === 'settings' }"
          :aria-selected="view === 'settings'"
          :aria-current="view === 'settings' ? 'page' : undefined"
          :tabindex="rovingTab === 'settings' ? 0 : -1"
          role="tab"
          aria-controls="panel-settings"
          @click="goToView('settings')"
        >
          <span class="nav-tab-num" aria-hidden="true">01</span>
          <span class="nav-tab-label">Settings</span>
        </button>
        <button
          id="tab-ingest"
          class="nav-tab"
          :class="{ active: view === 'ingest' }"
          :aria-selected="view === 'ingest'"
          :aria-current="view === 'ingest' ? 'page' : undefined"
          :tabindex="rovingTab === 'ingest' ? 0 : -1"
          role="tab"
          aria-controls="panel-ingest"
          @click="goToView('ingest')"
        >
          <span class="nav-tab-num" aria-hidden="true">02</span>
          <span class="nav-tab-label">Parse</span>
        </button>
        <button
          id="tab-matches"
          class="nav-tab"
          :class="{ active: view === 'matches' }"
          :aria-selected="view === 'matches'"
          :aria-current="view === 'matches' ? 'page' : undefined"
          :tabindex="rovingTab === 'matches' ? 0 : -1"
          role="tab"
          aria-controls="panel-matches"
          @click="goToView('matches')"
        >
          <span class="nav-tab-num" aria-hidden="true">03</span>
          <span class="nav-tab-label">
            Matches
            <span
              v-if="activeFilterCount > 0 && view !== 'matches'"
              class="nav-tab-filter-dot"
              :title="`${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`"
              aria-label="filters active"
            />
          </span>
        </button>
        <button
          id="tab-unknown"
          class="nav-tab"
          :class="{ active: view === 'unknown' }"
          :aria-selected="view === 'unknown'"
          :aria-current="view === 'unknown' ? 'page' : undefined"
          :tabindex="rovingTab === 'unknown' ? 0 : -1"
          role="tab"
          aria-controls="panel-unknown"
          @click="goToView('unknown')"
        >
          <span class="nav-tab-num" aria-hidden="true">04</span>
          <span class="nav-tab-label">
            Unknown
            <span v-if="unknownRecords.length > 0" class="nav-tab-badge">{{ unknownRecords.length }}</span>
          </span>
        </button>
        <button
          id="tab-compare"
          class="nav-tab"
          :class="{ active: view === 'compare' }"
          :aria-selected="view === 'compare'"
          :aria-current="view === 'compare' ? 'page' : undefined"
          :tabindex="rovingTab === 'compare' ? 0 : -1"
          role="tab"
          aria-controls="panel-compare"
          @click="goToView('compare')"
        >
          <span class="nav-tab-num" aria-hidden="true">05</span>
          <span class="nav-tab-label">Compare</span>
        </button>
        <button
          id="tab-elo"
          class="nav-tab"
          :class="{ active: view === 'elo' }"
          :aria-selected="view === 'elo'"
          :aria-current="view === 'elo' ? 'page' : undefined"
          :tabindex="rovingTab === 'elo' ? 0 : -1"
          role="tab"
          aria-controls="panel-elo"
          @click="goToView('elo')"
        >
          <span class="nav-tab-num" aria-hidden="true">06</span>
          <span class="nav-tab-label">Elo Calculator</span>
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
</template>
