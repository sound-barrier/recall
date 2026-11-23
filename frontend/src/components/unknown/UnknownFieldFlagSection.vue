<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'

import type { FieldFlag, MatchRecord } from '@/api-client'
import UnknownFieldFlagCard from '@/components/unknown/UnknownFieldFlagCard.vue'
import { useMatchActions } from '@/composables/matches/useMatchActions'
import { FIELD_FLAG_SECTION } from '@/match/quality/field-flags'
import { fieldLabel } from '@/match/quality/flag-labels'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'

// Flagged readings: values the cross-check doubted, each left out of the
// stats until the player settles it beside the pixels it was read from. One
// card per flag; settled ones (confirmed, or edited) wait behind "N reviewed",
// where a confirmation can be re-opened. The cards ask, this writes.
const matchesStore = useMatchesStore()
const { takePendingSection } = useUiStore()
const { onConfirmFieldReading, onUnconfirmFieldReading, onSetFlaggedReading } = useMatchActions()

interface FlagCard { id: string; rec: MatchRecord; flag: FieldFlag }

// The records as read: the card shows the value it asks about, and every
// write is built from them.
const cards = computed<FlagCard[]>(() => matchesStore.flaggedRecords.flatMap((rec) =>
  (rec.field_flags ?? []).map((flag) => ({ id: `${rec.match_key} ${flag.field}`, rec, flag }))))
const openCards = computed(() => cards.value.filter((c) => c.flag.state === 'open'))
const reviewedCards = computed(() => cards.value.filter((c) => c.flag.state !== 'open'))
const showReviewed = ref(false)
const root = useTemplateRef<HTMLElement>('root')
const heading = useTemplateRef<HTMLElement>('heading')

const CHANGED = 'This reading changed since you looked — Recall refreshed it. Check the new value before you confirm.'

// Per-card news and in-flight writes, keyed by card id so a refetch that
// rebuilds the card objects keeps them.
const news = ref<Record<string, string>>({})
const busy = ref<ReadonlySet<string>>(new Set())
// Where the last settled card went, for the section's one status line.
const announcement = ref('')

async function settle<T>(card: FlagCard, write: () => Promise<T>): Promise<T | undefined> {
  if (busy.value.has(card.id)) return undefined
  busy.value = new Set([...busy.value, card.id])
  news.value = { ...news.value, [card.id]: '' }
  announcement.value = ''
  try {
    return await write()
  } finally {
    busy.value = new Set([...busy.value].filter((id) => id !== card.id))
  }
}

const openIndex = (card: FlagCard) => openCards.value.findIndex((c) => c.id === card.id)

async function confirm(card: FlagCard) {
  const at = openIndex(card)
  const outcome = await settle(card, () => onConfirmFieldReading(card.rec.match_key, card.flag.field, card.flag.value))
  if (outcome === 'changed') news.value = { ...news.value, [card.id]: CHANGED }
  if (outcome === 'done') await afterSettle(card, at)
}
async function unconfirm(card: FlagCard) {
  if (await settle(card, () => onUnconfirmFieldReading(card.rec.match_key, card.flag.field))) await afterSettle(card, -1)
}
async function write(card: FlagCard, value: string) {
  const at = openIndex(card)
  if (await settle(card, () => onSetFlaggedReading(card.rec.match_key, card.flag.field, value))) await afterSettle(card, at)
}

// A settle moves its card between the open list and "N reviewed", and the
// card takes the control holding focus with it — and its own status line.
// So focus goes on to the work that is left (the card now in its place, the
// re-opened card itself, or the heading when nothing is open) and the move
// is announced here. A card that stayed open kept its focus; nothing moves.
interface Landing { message: string; focusIndex: number }

function landing(card: FlagCard, wasAt: number): Landing | null {
  const label = fieldLabel(card.flag.field, card.rec.data)
  const open = openCards.value.length
  const nowAt = openIndex(card)
  if (nowAt >= 0) {
    return card.flag.state === 'open' ? null : { message: `${label} re-opened — ${open} open.`, focusIndex: nowAt }
  }
  const settled = reviewedCards.value.find((c) => c.id === card.id)
  const verb = settled?.flag.state === 'confirmed' ? 'confirmed' : 'corrected'
  return { message: `${label} ${verb} — moved to ${reviewedCards.value.length} reviewed.`, focusIndex: Math.min(wasAt, open - 1) }
}

async function afterSettle(card: FlagCard, wasAt: number) {
  await nextTick()
  const land = landing(card, wasAt)
  if (!land) return
  announcement.value = land.message
  const target = land.focusIndex >= 0
    ? root.value?.querySelectorAll<HTMLElement>(':scope > article')[land.focusIndex]
    : heading.value
  target?.focus()
}

// The dossier's notice sends the player here. The view is lazy, so the link
// leaves a one-shot request this takes on mount; the tick lets the tab
// change's own panel focus land first, so the heading wins.
onMounted(async () => {
  if (!takePendingSection(FIELD_FLAG_SECTION)) return
  await nextTick()
  heading.value?.scrollIntoView?.({ block: 'start' })
  heading.value?.focus({ preventScroll: true })
})
</script>

<template>
  <div v-if="cards.length > 0" :id="FIELD_FLAG_SECTION" ref="root" class="unknown-list field-flag-section">
    <h3 ref="heading" class="needs-review-heading" tabindex="-1">
      Flagged readings — {{ openCards.length > 0 ? openCards.length : 'all reviewed' }}
    </h3>
    <p class="needs-review-desc">
      Recall's cross-checks doubted these readings, so each one stays out of your stats until you settle it: confirm it's right as read, use the reading another source made, or correct it.
    </p>
    <p role="status" class="sr-only">
      {{ announcement }}
    </p>
    <UnknownFieldFlagCard
      v-for="card in openCards"
      :key="card.id"
      :rec="card.rec"
      :flag="card.flag"
      :notice="news[card.id] ?? ''"
      :busy="busy.has(card.id)"
      @confirm="confirm(card)"
      @unconfirm="unconfirm(card)"
      @write="write(card, $event)"
    />

    <template v-if="reviewedCards.length > 0">
      <button
        type="button"
        class="empty-link field-flag-reviewed-toggle"
        :aria-expanded="showReviewed"
        @click="showReviewed = !showReviewed"
      >
        {{ reviewedCards.length }} reviewed — {{ showReviewed ? 'hide' : 'show' }}
      </button>
      <UnknownFieldFlagCard
        v-for="card in (showReviewed ? reviewedCards : [])"
        :key="card.id"
        :rec="card.rec"
        :flag="card.flag"
        :notice="news[card.id] ?? ''"
        :busy="busy.has(card.id)"
        @confirm="confirm(card)"
        @unconfirm="unconfirm(card)"
        @write="write(card, $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.field-flag-reviewed-toggle {
  align-self: flex-start;
}

.needs-review-heading:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
