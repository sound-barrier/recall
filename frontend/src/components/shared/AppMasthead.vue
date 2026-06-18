<script setup lang="ts">
// The app masthead: brand/repo link, the primary tablist, the parse chip,
// the W/L/D scoreboard, profile switcher, and the version + update-check
// control. Presentational — App owns the state and passes it in; the tab
// keyboard-nav handler is threaded as `onTabKeydown` so focus management
// stays in App's useTabKeyboardNav. (Props will become injects in the
// state→provide/inject stage of the App thin-shell refactor.)
import { OpenURL } from '@/api'
import type { TabId } from '@/composables/shared/useTabKeyboardNav'
import type { ParseProgressEvent } from '@/components/ingest/ParseProgressPanel.vue'
import MastheadParseChip from '@/components/shared/MastheadParseChip.vue'
import ProfileSwitcher from '@/components/shared/ProfileSwitcher.vue'

defineProps<{
  view: TabId
  activeFilterCount: number
  unknownCount: number
  parseProgress: ParseProgressEvent | null
  recordsCount: number
  wld: { w: number; l: number; d: number }
  recordsPulse: boolean
  appVersion: string
  updateCheckBusy: boolean
  hasUpdateInfo: boolean
  onTabKeydown: (e: KeyboardEvent) => void
}>()

const emit = defineEmits<{
  'go-to-view': [view: TabId]
  'check-updates': []
}>()

const GITHUB_REPO_URL = 'https://github.com/sound-barrier/recall'
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
          :tabindex="view === 'settings' ? 0 : -1"
          role="tab"
          aria-controls="panel-settings"
          @click="emit('go-to-view', 'settings')"
        >
          <span class="nav-tab-num">01</span>
          <span class="nav-tab-label">Settings</span>
        </button>
        <button
          id="tab-ingest"
          class="nav-tab"
          :class="{ active: view === 'ingest' }"
          :aria-selected="view === 'ingest'"
          :aria-current="view === 'ingest' ? 'page' : undefined"
          :tabindex="view === 'ingest' ? 0 : -1"
          role="tab"
          aria-controls="panel-ingest"
          @click="emit('go-to-view', 'ingest')"
        >
          <span class="nav-tab-num">02</span>
          <span class="nav-tab-label">Parse</span>
        </button>
        <button
          id="tab-matches"
          class="nav-tab"
          :class="{ active: view === 'matches' }"
          :aria-selected="view === 'matches'"
          :aria-current="view === 'matches' ? 'page' : undefined"
          :tabindex="view === 'matches' ? 0 : -1"
          role="tab"
          aria-controls="panel-matches"
          @click="emit('go-to-view', 'matches')"
        >
          <span class="nav-tab-num">03</span>
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
          :tabindex="view === 'unknown' ? 0 : -1"
          role="tab"
          aria-controls="panel-unknown"
          @click="emit('go-to-view', 'unknown')"
        >
          <span class="nav-tab-num">04</span>
          <span class="nav-tab-label">
            Unknown
            <span v-if="unknownCount > 0" class="nav-tab-badge">{{ unknownCount }}</span>
          </span>
        </button>
      </nav>
    </div>
    <div class="masthead-right">
      <MastheadParseChip
        :parse-progress="parseProgress"
        @go-to-view="emit('go-to-view', $event)"
      />
      <div
        v-if="recordsCount > 0 && view === 'matches'"
        class="scoreboard"
        :class="{ pulse: recordsPulse }"
        title="Wins · Losses · Draws across the currently filtered matches"
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
      </div>
      <ProfileSwitcher />
      <div class="ver-block">
        <span v-if="appVersion" class="app-version">v{{ appVersion }}</span>
        <!-- Single trigger — the modal owns all result presentation.
             NOT auto-fired on mount; opting in keeps the boot path
             off the network. The reminder banner above main content
             nudges users who haven't checked in 90+ days. -->
        <button
          class="ver-btn ver-btn-check"
          :disabled="updateCheckBusy && !hasUpdateInfo"
          :title="updateCheckBusy ? 'Checking GitHub releases…' : 'Check GitHub for a newer release'"
          data-update-check-trigger
          @click="emit('check-updates')"
        >
          {{ updateCheckBusy && !hasUpdateInfo ? 'Checking…' : 'Check for updates' }}
        </button>
      </div>
    </div>
  </header>
</template>
