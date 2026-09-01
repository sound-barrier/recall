<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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

// The one thing on this rail read off the wall clock rather than off the
// records: whether the session it is narrating is still running. A computed
// over `records` alone never re-evaluates while nobody is playing, which is
// exactly when it stops being true — a rail raised at 21:00 still said "Live"
// at 04:00. The tick is the dependency that lets it expire.
//
// The hop is capped because setTimeout counts elapsed AWAKE time: armed as one
// long delay, a machine that slept through the night would wake with the timer
// still pending. Same reason, same cap, as the session toast.
const MAX_HOP_MS = 60_000
const clockTick = ref(Date.now())
let expiryTimer: number | null = null

function armExpiry() {
  if (expiryTimer !== null) window.clearTimeout(expiryTimer)
  const endsAt = readout.value?.summary.endsAt
  const remaining = endsAt === undefined ? MAX_HOP_MS : endsAt - Date.now()
  expiryTimer = window.setTimeout(() => {
    expiryTimer = null
    clockTick.value = Date.now()
    armExpiry()
  }, Math.max(0, Math.min(remaining, MAX_HOP_MS)))
}

// A wake or a tab-return is when the wall clock and the timer are most likely
// to disagree, so re-check immediately rather than waiting out the hop.
function recheckOnWake() {
  if (document.visibilityState !== 'visible') return
  clockTick.value = Date.now()
  armExpiry()
}

onMounted(() => {
  armExpiry()
  document.addEventListener('visibilitychange', recheckOnWake)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', recheckOnWake)
  if (expiryTimer !== null) window.clearTimeout(expiryTimer)
})

const readout = computed(() => liveSessionReadout(records.value, clockTick.value))

// Dismissal sticks to the SESSION, not to this component instance: startedAt
// is the session's own identity and does not slide forward as games land, so
// "×" survives the next match instead of buying one game of quiet. It is
// deliberately NOT cleared when the readout goes null — a refetch landing an
// empty list for a frame would otherwise put back the rail the player closed.
const dismissedSession = ref<number | null>(null)

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
    // The accessible name carries a verdict, so the visible text has to carry
    // the same one. Naming a judgment only to a screen reader is the inverse
    // of the rule that put the word there.
    tint: signTint(summary.netPercent),
    partial: summary.readCount < summary.matches ? `${summary.readCount}/${summary.matches} read` : '',
  }
})

// The shared .tint-up / .tint-down pair, the same one every climb widget
// uses. A flat session gets neither — nothing moved, so nothing is colored.
function signTint(delta: number): string {
  if (delta > 0) return 'tint-up'
  if (delta < 0) return 'tint-down'
  return ''
}

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
        · <span
          class="sb-move"
          :class="movement.tint"
          role="img"
          :aria-label="movement.name"
        >{{ movement.text }}</span>
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
