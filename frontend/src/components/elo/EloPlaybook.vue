<script setup lang="ts">
import { computed } from 'vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import type { EvidenceItem } from '@/composables/elo/useEloEvidence'
import EloNextMoves from '@/components/elo/EloNextMoves.vue'
import EloEvidencePanel from '@/components/elo/EloEvidencePanel.vue'
import EloLiftTable from '@/components/elo/EloLiftTable.vue'
import EloHeroGap from '@/components/elo/EloHeroGap.vue'

// "What you can do about it" — the page's single improvement band: the
// ranked next-moves card, then the levers you control, the condition
// lifts, and the scoreboard drivers. Each block still hides itself on
// thin data; the band hides when none of them have anything to say.
const props = defineProps<{ items: EvidenceItem[] }>()

const { lift } = useEloCalc()
const hasContent = computed(() => props.items.length > 0 || lift.value.length > 0)
</script>

<template>
  <section v-if="hasContent" class="elo-band" aria-labelledby="elo-playbook-title" data-elo-playbook>
    <h3 id="elo-playbook-title" class="elo-band-title">
      What you can do about it
    </h3>
    <p class="elo-band-sub">
      Measured from your own games — the levers you control, priced in rank meter.
    </p>
    <EloNextMoves />
    <EloEvidencePanel :items="items" />
    <EloLiftTable />
    <EloHeroGap />
  </section>
</template>
