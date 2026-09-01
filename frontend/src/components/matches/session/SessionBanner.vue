<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { liveSessionReadout } from '@/match/dossier/match-session-live'
import { signJudgment } from '@/match/trends/match-heatmap-helpers'
import { useMatchesStore } from '@/stores/matches'

// Where the player sits on the ladder right now, and what the running session
// has done to it. The session tally is spelled elsewhere too; the RANK is the
// half nothing else carries mid-session, which is why the pill leads and the
// W-L follows it.
//
// Reads the FULL corpus, not narrowedRecords: a filter the player left on the
// Matches tab must not decide whether they are "in a session".
// It renders INSIDE .container, which App already marks inert while a modal
// has frozen the background — unlike ParseStatusBar, which sits outside and
// has to self-apply it.
const { records } = storeToRefs(useMatchesStore())

const readout = computed(() => liveSessionReadout(records.value))

// Dismissal sticks to the SESSION, not to this component instance: startedAt
// is the session's own identity and does not slide forward as games land, so
// "×" survives the next match instead of buying one game of quiet.
const dismissedSession = ref<number | null>(null)
watch(readout, (now) => {
  if (now === null) dismissedSession.value = null
})

const visible = computed(() =>
  readout.value !== null && readout.value.summary.startedAt !== dismissedSession.value)

const rankLabel = computed(() => {
  const rank = readout.value?.rank
  if (!rank) return null
  const tier = rank.tier.charAt(0).toUpperCase() + rank.tier.slice(1)
  return { name: `${tier} ${rank.level}`, progress: rank.progress }
})

// Absent entirely when no capture in the session reported a rank pill — a
// session whose readings went unseen has an unknown movement, not a flat one.
const movement = computed(() => {
  const summary = readout.value?.summary
  if (!summary || summary.readCount === 0) return null
  const signed = `${summary.netPercent > 0 ? '+' : ''}${summary.netPercent}%`
  return {
    text: signed,
    name: `${signed} rank this session — ${signJudgment(summary.netPercent)}`,
    partial: summary.readCount < summary.matches ? `${summary.readCount}/${summary.matches} read` : '',
  }
})

function dismiss() {
  dismissedSession.value = readout.value?.summary.startedAt ?? null
}
</script>

<template>
  <aside
    v-if="visible && readout"
    class="session-banner"
    role="status"
    aria-label="Live session"
    aria-live="polite"
  >
    <span class="eyebrow accent sb-live">Live</span>

    <span v-if="rankLabel" class="sb-rank">
      <strong>{{ rankLabel.name }}</strong>
      <span v-if="rankLabel.progress !== null" class="sb-progress">{{ rankLabel.progress }}%</span>
    </span>
    <span v-else class="sb-rank sb-rank-unread">No rank read</span>

    <span class="sb-rule" aria-hidden="true" />

    <span class="sb-tally">
      {{ readout.summary.matches }} game{{ readout.summary.matches === 1 ? '' : 's' }}
      · {{ readout.summary.w }}W-{{ readout.summary.l }}L<template v-if="readout.summary.d">-{{ readout.summary.d }}D</template>
      <template v-if="movement">
        · <span class="sb-move" role="img" :aria-label="movement.name">{{ movement.text }}</span>
        <span v-if="movement.partial" class="sb-partial">({{ movement.partial }})</span>
      </template>
    </span>

    <span class="sb-role">{{ readout.roleLabel }}</span>

    <button type="button" class="sb-close" aria-label="Dismiss live session" @click="dismiss">
      ×
    </button>
  </aside>
</template>

<style scoped src="./SessionBanner.css"></style>
