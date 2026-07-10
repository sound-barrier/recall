<script setup lang="ts">
import { computed } from 'vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { useOWData } from '@/composables/shared/useOWData'
import { nextMoves } from '@/match/elo-next-moves'

// The playbook's opener: up to three ranked, priced actions from the
// player's own games (the numbering IS the priority). Hidden below two
// moves — one action isn't a plan.
const { trackRecs, lift } = useEloCalc()
const ow = useOWData()

const moves = computed(() => nextMoves(trackRecs.value, lift.value, {
  heroRole: ow.heroRole,
  heroDisplayName: ow.heroDisplayName,
  mapDisplayName: ow.mapDisplayName,
}))
</script>

<template>
  <div v-if="moves.length >= 2" class="elo-next-moves" data-elo-next-moves>
    <p class="elo-next-moves-title">
      Your next {{ moves.length === 3 ? 'three' : 'two' }} moves
    </p>
    <ol class="elo-next-moves-list">
      <li v-for="m in moves" :key="m.id" :data-elo-move="m.id">
        <span class="elo-move-label">{{ m.label }}</span>
        <span class="elo-move-detail">{{ m.detail }}</span>
      </li>
    </ol>
  </div>
</template>
