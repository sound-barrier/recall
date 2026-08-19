<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import { useMatchActions } from '@/composables/matches/useMatchActions'
import { useOWData } from '@/composables/shared/useOWData'
import { lazyView } from '@/components/app/lazy-view'
import type { CoachLabels, CoachPlayerView } from '@/components/coach/room/coach-room-props'
import ReviewsIndex from '@/components/reviews/ReviewsIndex.vue'
import SelfReviewSheet from '@/components/reviews/SelfReviewSheet.vue'
import { HEADER_SAVE_KEY, useSelfReviewStore } from '@/stores/selfReview'
import { useCoachStore } from '@/stores/coach'

// 07 Reviews — the home of the review cycle.
//
// Coaching had every entry point except a place: a profile-menu item, a
// bulk-bar modal toggle, two "Import…" buttons, a keyboard chord and a
// banner. There was no surface anywhere that listed a review you gave, got,
// or were in the middle of. This tab is that place, and the Film Room now
// renders INSIDE it rather than as the one view outside the tablist.
//
// Three states, one tab. While a coaching session is open the tab IS the
// room over someone else's loaned matches — the desk, the session sheet —
// and the index is not shown underneath it, because the index is about the
// player's own data and a session sets that aside. While one of the
// player's OWN review sittings is open the tab is the same room over their
// own matches, in their own voice, with the sitting's sheet. Otherwise the
// tab is the index: the shelf the reels come off and go back on. The
// session wins over the sitting: a bundle opened mid-sitting shows the
// coach's room (the sitting's writes are gated anyway).
//
// The room stays its own chunk. The tab is visited by people who will never
// open a bundle, and the room's bytes are the largest thing behind it. Same
// wrapper as the tabs themselves, so a failed room chunk shows the reload
// affordance instead of an empty tabpanel.
const CoachRoomView = lazyView(() => import('@/components/coach/room/CoachRoomView.vue'))

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

// The player's own sitting. The room's identity is nominal here — the reel
// and the card speak in the viewer's voice, and nobody is asked who this
// bundle is about — but the room needs SOME handle to consider itself
// confirmed, so it gets one.
const selfReview = useSelfReviewStore()
const { roomOpen: sittingOpen, open: sitting } = storeToRefs(selfReview)
const SELF: CoachPlayerView = { handle: 'you', message: '' }
// Your own matches, so the replay code copies through the Matches action —
// the same routine the detail panel uses over the same records.
const { onCopyReplayCode: copyReplayCode } = useMatchActions()
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
    <CoachRoomView
      v-else-if="sittingOpen && sitting"
      :player="SELF"
      voice="your"
      :records="selfReview.records"
      :notes="selfReview.notes"
      :moments="selfReview.moments"
      :selected-key="selfReview.selectedKey"
      :summary="selfReview.summary"
      :save-state-for="selfReview.saveStateFor"
      :labels="coachLabels"
      @select="selfReview.selectKey"
      @update-note="selfReview.updateNote"
      @update-moment="selfReview.updateMoment"
      @remove-moment="selfReview.removeMoment"
      @copy-replay="copyReplayCode"
    >
      <template #sheet="{ wld, winRate, focusTally, notesLine }">
        <SelfReviewSheet
          :title="selfReview.title"
          :wld="wld"
          :win-rate="winRate"
          :focus-tally="focusTally"
          :notes-line="notesLine"
          :summary="selfReview.summary"
          :header-save-state="selfReview.saveStateFor(HEADER_SAVE_KEY)"
          :finished-at="sitting.finished_at ?? ''"
          @update-title="selfReview.updateTitle"
          @update-summary="selfReview.updateSummary"
          @finish="selfReview.finish()"
          @close="selfReview.close()"
        />
      </template>
    </CoachRoomView>
    <ReviewsIndex v-else />
  </section>
</template>
