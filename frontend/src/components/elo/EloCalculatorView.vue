<script setup lang="ts">
import { computed } from 'vue'
// Loaded here (not app.css) so the feature's styles code-split into the lazy
// Elo chunk instead of initial paint. Every rule is scoped under #panel-elo.
import '@/styles/elo.css'
import { useMatchesStore } from '@/stores/matches'
import { useOWData } from '@/composables/shared/useOWData'
import { provideEloCalculator, useEloCalculator } from '@/composables/elo/useEloCalculator'
import { useEloEvidence } from '@/composables/elo/useEloEvidence'
import { fmtRank } from '@/components/elo/elo-format'
import EloTrackPicker from '@/components/elo/EloTrackPicker.vue'
import EloAnswer from '@/components/elo/EloAnswer.vue'
import EloResultsPanel from '@/components/elo/EloResultsPanel.vue'
import EloDeltaStrip from '@/components/elo/EloDeltaStrip.vue'
import EloProjectionChart from '@/components/elo/EloProjectionChart.vue'
import EloMythChecks from '@/components/elo/EloMythChecks.vue'
import EloSeasonSim from '@/components/elo/EloSeasonSim.vue'
import EloSkillCurve from '@/components/elo/EloSkillCurve.vue'
import EloPlaybook from '@/components/elo/EloPlaybook.vue'
import EloInputsPanel from '@/components/elo/EloInputsPanel.vue'
import EloHeroPicker from '@/components/elo/EloHeroPicker.vue'

// Elo Calculator — a loan-calculator for ranked climbing, told in a fixed
// arc: how hard the climb is (verdict + simulated seasons), what to do
// about it (the playbook), the tool to price that plan (the editable
// assumptions + hero nudges), proof you're already moving (skill curve),
// and — last, for the cursed nights — the "is it rigged?" receipts.
// Pure layout: state lives in useEloCalculator (provided to the panels).
const matchesStore = useMatchesStore()
const ow = useOWData()

const records = computed(() => matchesStore.records.filter((r) => !r.hidden))
const calc = useEloCalculator({ records, heroRole: ow.heroRole, mapGameMode: ow.mapGameMode })
provideEloCalculator(calc)

const { items: evidenceItems } = useEloEvidence({
  trackRecs: calc.trackRecs,
  leaverHandling: matchesStore.matchesNarrow.leaverHandling,
  heroRole: ow.heroRole,
})

const trackName = computed(() => calc.trackLabels[calc.track.value])
const rankNow = computed(() => fmtRank(calc.currentTier.value, calc.currentDivision.value))
const target = computed(() => fmtRank(calc.targetTier.value, calc.targetDivision.value))
</script>

<template>
  <section
    id="panel-elo"
    role="tabpanel"
    aria-labelledby="tab-elo"
    tabindex="-1"
    class="settings elo-view"
  >
    <header class="settings-intro">
      <p class="eyebrow settings-eyebrow">
        {{ trackName }} · {{ rankNow }}
      </p>
      <h2 class="settings-heading">
        How long to reach <em>{{ target }}</em>?
      </h2>
      <p class="elo-desc">
        A climb calculator, filled in from your own games and fully editable. The honest price of the
        climb, the playbook that shortens it, and — for the nights it feels rigged — the receipts.
      </p>
    </header>

    <EloTrackPicker />

    <section class="elo-band" aria-labelledby="elo-verdict-title">
      <h3 id="elo-verdict-title" class="elo-band-title">
        The verdict — and the dials behind it
      </h3>
      <p class="elo-band-sub">
        Filled in from your games — everything on the right is editable, and the answer follows it live.
      </p>
      <div class="elo-verdict-adjust-grid">
        <div class="elo-verdict-col">
          <EloAnswer />
          <EloDeltaStrip />
          <EloResultsPanel />
        </div>
        <div class="elo-adjust-col">
          <EloInputsPanel />
          <EloHeroPicker />
        </div>
      </div>
      <EloProjectionChart />
    </section>

    <EloSeasonSim />

    <EloPlaybook :items="evidenceItems" />

    <EloSkillCurve />

    <EloMythChecks />
  </section>
</template>
