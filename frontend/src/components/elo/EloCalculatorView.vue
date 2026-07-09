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
import EloProjectionChart from '@/components/elo/EloProjectionChart.vue'
import EloMythChecks from '@/components/elo/EloMythChecks.vue'
import EloStatDrivers from '@/components/elo/EloStatDrivers.vue'
import EloInputsPanel from '@/components/elo/EloInputsPanel.vue'
import EloHeroPicker from '@/components/elo/EloHeroPicker.vue'
import EloEvidencePanel from '@/components/elo/EloEvidencePanel.vue'

// Elo Calculator — a loan-calculator for ranked climbing. Inputs seed from the
// picked track's own games (all editable); the verdict + chart lead, the form
// sits below as "adjust the assumptions", and two evidence bands answer
// "Elo Hell" with the player's own numbers. Pure layout: state lives in
// useEloCalculator (provided to the panels).
const matchesStore = useMatchesStore()
const ow = useOWData()

const records = computed(() => matchesStore.records.filter((r) => !r.hidden))
const calc = useEloCalculator({ records, heroRole: ow.heroRole })
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
      <p class="settings-eyebrow">
        {{ trackName }} · {{ rankNow }}
      </p>
      <h2 class="settings-heading">
        How long to reach <em>{{ target }}</em>?
      </h2>
      <p class="elo-desc">
        A climb calculator, filled in from your own games and fully editable. Two honest futures —
        keeping your win rate, versus what tougher opponents actually do — plus a reality check on "Elo Hell."
      </p>
    </header>

    <EloTrackPicker />

    <section class="elo-band" aria-labelledby="elo-verdict-title">
      <h3 id="elo-verdict-title" class="elo-band-title">
        The verdict
      </h3>
      <EloAnswer />
      <div class="elo-verdict-grid">
        <EloResultsPanel />
        <EloProjectionChart />
      </div>
    </section>

    <section class="elo-band" aria-labelledby="elo-adjust-title">
      <h3 id="elo-adjust-title" class="elo-band-title">
        Adjust the assumptions
      </h3>
      <p class="elo-band-sub">
        These come straight from your games — change anything to explore a what-if.
      </p>
      <div class="elo-adjust-grid">
        <EloInputsPanel />
        <EloHeroPicker />
      </div>
    </section>

    <EloMythChecks />

    <EloStatDrivers />

    <EloEvidencePanel :items="evidenceItems" />
  </section>
</template>
