<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { storeToRefs } from 'pinia'

import { useOWData } from '@/composables/shared/useOWData'
import type { CoachLabels } from '@/components/coach/room/coach-room-props'
import ReviewsIndex from '@/components/reviews/ReviewsIndex.vue'
import { useCoachStore } from '@/stores/coach'

// 07 Reviews — the home of the review cycle.
//
// Coaching had every entry point except a place: a profile-menu item, a
// bulk-bar modal toggle, two "Import…" buttons, a keyboard chord and a
// banner. There was no surface anywhere that listed a review you gave, got,
// or were in the middle of. This tab is that place, and the Film Room now
// renders INSIDE it rather than as the one view outside the tablist.
//
// Two states, one tab. While a coaching session is open the tab IS the room
// — the loaned matches, the desk, the session sheet — and the index is not
// shown underneath it, because the index is about the player's own data and
// a session sets that aside. Otherwise the tab is the index: the shelf the
// reels come off and go back on.
//
// The room stays its own chunk. The tab is visited by people who will never
// open a bundle, and the room's bytes are the largest thing behind it.
const CoachRoomView = defineAsyncComponent(() => import('@/components/coach/room/CoachRoomView.vue'))

// The room is presentational by design — props in, events out — so this
// view hands it the session store's state and routes every intent straight
// back to a store action. This wiring used to live in App.vue, when the room
// was App's own view; it moved here with the room. Canonical hero/map
// spellings come from the shared reference-data lookups.
const coachStore = useCoachStore()
const { sessionActive } = storeToRefs(coachStore)
const { mapDisplayName, heroDisplayName } = useOWData()
const coachLabels: CoachLabels = { map: mapDisplayName, hero: heroDisplayName }

const roomOpen = computed(() => sessionActive.value && coachStore.player !== null)
</script>

<template>
  <section
    id="panel-reviews"
    role="tabpanel"
    aria-labelledby="tab-reviews"
    tabindex="-1"
    class="settings reviews-view"
  >
    <CoachRoomView
      v-if="roomOpen && coachStore.player"
      :player="coachStore.player"
      :records="coachStore.loanedRecords"
      :notes="coachStore.notes"
      :moments="coachStore.moments"
      :selected-key="coachStore.selectedKey"
      :summary="coachStore.summary"
      :coach-name="coachStore.coachName"
      :save-state-for="coachStore.saveStateFor"
      :can-export="coachStore.canExportNotes"
      :export-reason="coachStore.exportBlockedReason || undefined"
      :labels="coachLabels"
      :end-armed="coachStore.endArmed"
      @select="coachStore.selectKey"
      @update-note="coachStore.updateNote"
      @update-moment="coachStore.updateMoment"
      @remove-moment="coachStore.removeMoment"
      @copy-replay="coachStore.copyReplayCode"
      @update-summary="coachStore.updateSummary"
      @confirm-player="coachStore.setPlayerHandle"
      @export="coachStore.exportNotes"
      @end="coachStore.requestEndSession"
      @keep-working="coachStore.cancelEndSession"
    />
    <ReviewsIndex v-else />
  </section>
</template>
