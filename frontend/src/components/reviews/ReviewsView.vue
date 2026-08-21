<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import { useMatchActions } from '@/composables/matches/useMatchActions'
import { useOWData } from '@/composables/shared/useOWData'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { lazyView } from '@/components/app/lazy-view'
import type { CoachLabels, CoachPlayerView } from '@/components/coach/room/coach-room-props'
import ReviewsIndex from '@/components/reviews/ReviewsIndex.vue'
import SelfReviewSheet from '@/components/reviews/SelfReviewSheet.vue'
import { FOCUS_SAVE_KEY, HEADER_SAVE_KEY, useSelfReviewStore } from '@/stores/selfReview'
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
// Your own data, so the player's write gate applies to the room too — the
// editor, the strip and the sheet refuse with the reason whenever writes
// are locked, the same as every sibling affordance.
const { lockReason } = useWriteGate()
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
      :api="coachStore.roomApi"
      :coach-name="coachStore.coachName"
      :can-export="coachStore.canExportNotes"
      :export-reason="coachStore.exportBlockedReason || undefined"
      :labels="coachLabels"
      :end-armed="coachStore.endArmed"
      @copy-replay="coachStore.copyReplayCode"
      @update-focus-items="coachStore.updateFocusItems"
      @confirm-player="coachStore.setPlayerHandle"
      @export="coachStore.exportNotes"
      @end="coachStore.requestEndSession"
      @keep-working="coachStore.cancelEndSession"
    />
    <CoachRoomView
      v-else-if="sittingOpen && sitting"
      :player="SELF"
      voice="your"
      :locked-reason="lockReason"
      :omit-review-id="sitting.review_id"
      :api="selfReview.roomApi"
      :labels="coachLabels"
      removable-frames
      @remove-frame="(k: string) => selfReview.removeMatchFromOpenSitting(k)"
      @copy-replay="copyReplayCode"
    >
      <template #sheet="{ wld, winRate, focusTally, notesLine }">
        <SelfReviewSheet
          :title="selfReview.title"
          :wld="wld"
          :win-rate="winRate"
          :focus-tally="focusTally"
          :notes-line="notesLine"
          :focus-items="selfReview.focusItems"
          :header-save-state="selfReview.saveStateFor(HEADER_SAVE_KEY)"
          :focus-save-state="selfReview.saveStateFor(FOCUS_SAVE_KEY)"
          :finished-at="sitting.finished_at ?? ''"
          :blocked-reason="lockReason"
          @update-title="selfReview.updateTitle"
          @update-focus-items="selfReview.updateFocusItems"
          @finish="selfReview.finish()"
          @close="selfReview.close()"
        />
      </template>
    </CoachRoomView>
    <ReviewsIndex v-else />
  </section>
</template>
