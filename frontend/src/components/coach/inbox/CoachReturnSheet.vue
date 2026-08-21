<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import CoachReturnCard from '@/components/coach/inbox/CoachReturnCard.vue'
import { useCoachReturnDecisions } from '@/composables/coach/useCoachReturnDecisions'
import { useModalFocusTrap } from '@/composables/shared/keyboard/useModalFocusTrap'
import { useCoachReturnsStore } from '@/stores/coachReturns'

// The return of notes — the player decides on one coach's archive.
//
// Opens from the import that staged it, or from the Matches banner that
// keeps nagging while notes are undecided. Every verdict is held locally
// (useCoachReturnDecisions) and written in ONE partial PUT when the player
// finishes or puts it off, so flipping down a list of notes is not a
// request per click.
//
// Reads the store directly, like every other store-bound component; the
// staged sheet, the write, and the inbox refresh all live there.
const returns = useCoachReturnsStore()
const { returnSheet } = storeToRefs(returns)

const open = computed(() => returnSheet.value !== null)
const decisions = useCoachReturnDecisions(returnSheet)

const coachName = computed(() => returnSheet.value?.coach_name ?? 'your coach')
const focusItems = computed(() => returnSheet.value?.focus_items ?? [])
const notes = computed(() => returnSheet.value?.notes ?? [])
const mismatchedHandle = computed(() =>
  returnSheet.value?.player_mismatch ? returnSheet.value.player_handle : '')

// Set when the write came back an error. The verdicts are still in hand,
// so the honest move is to say so and let the player press Finish again —
// closing would throw away work the server never took.
const saveFailed = ref(false)

// One commit path behind both buttons: "Decide later" and "Finish" write
// the same partial map — they differ in what the player means by them, not
// in what is saved. An untouched sheet closes without a request.
//
// The store REJECTS on a failed write rather than swallowing it into the
// error banner, precisely so this caller can keep the dialog up.
async function commit() {
  const sheet = returnSheet.value
  if (sheet && decisions.dirty.value) {
    try {
      await returns.decide(sheet.id, decisions.body.value)
    } catch (_) {
      saveFailed.value = true
      return
    }
  }
  saveFailed.value = false
  returns.closeReturnSheet()
}

// Discarding throws the file away rather than deciding it. Armed first,
// because it is the one irreversible button in the dialog and it sits beside
// two that are not — and because "skip every note" is NOT the same thing: that
// writes decisions and marks the matches reviewed by a coach whose review the
// player has just said they do not want.
const discardArmed = ref(false)

async function discard() {
  const sheet = returnSheet.value
  if (!sheet) return
  discardArmed.value = false
  await returns.discardReturnSheet(sheet.id)
}

// A sheet that closes while the confirm is up must not reopen holding it.
watch(open, (isOpen) => { if (!isOpen) discardArmed.value = false })

useModalFocusTrap(open, {
  containerSelector: '.coach-return-sheet',
  onClose: () => { void commit() },
})
</script>

<template>
  <div v-if="open" class="return-backdrop">
    <section
      class="paper coach-return-sheet"
      role="dialog"
      aria-modal="true"
      :aria-label="`Notes from ${coachName}`"
    >
      <header class="return-head">
        <h2 class="return-title">
          Notes from {{ coachName }}
        </h2>
        <section v-if="focusItems.length" class="return-focus" aria-labelledby="return-focus-head">
          <p id="return-focus-head" class="eyebrow ink">
            What to work on
          </p>
          <!-- No Skip, and no per-item decision. A coach's items are live
               the moment the file is staged; they are already in "What
               you're working on" and are acknowledged there. A player can
               disagree with their coach — they still have to hear it. -->
          <ul class="return-focus-list">
            <li v-for="item in focusItems" :key="item.item_id">
              {{ item.text }}
            </li>
          </ul>
          <p class="return-focus-note">
            These are already on your list. Accept them there when you have read them.
          </p>
        </section>
        <p v-if="mismatchedHandle" class="return-mismatch">
          This notes file was written about {{ mismatchedHandle }}. Accept only what belongs here.
        </p>
        <p v-if="saveFailed" class="return-failed" role="alert">
          Your decisions could not be saved. Nothing was lost — they are still on this sheet.
          Try Finish again.
        </p>
      </header>

      <div class="return-bulk">
        <button type="button" class="paper-btn" @click="decisions.acceptAll()">
          Accept all
        </button>
        <button type="button" class="paper-btn" @click="decisions.skipAll()">
          Skip all
        </button>
      </div>

      <!-- Focusable because it scrolls: when every note is an orphan the
           cards carry no radios, and an unfocusable scroll container is
           unreachable by keyboard (axe scrollable-region-focusable). -->
      <div class="return-cards" tabindex="0" role="group" aria-label="Notes in this file">
        <CoachReturnCard
          v-for="note in notes"
          :key="note.note_id"
          :note="note"
          :verdict="decisions.verdictOf(note.note_id)"
          @decide="(d) => decisions.decide(note, d)"
        />
      </div>

      <footer class="return-foot">
        <!--
          Armed, and it says what it destroys. The wrong file imported, or a
          review the player has decided against, used to leave a sheet
          nagging from the banner with no way to be rid of it: the server has
          had this endpoint the whole time and nothing called it.
        -->
        <template v-if="discardArmed">
          <span class="return-discard-ask">Throw these notes away without deciding them?</span>
          <button type="button" class="paper-btn" @click="discardArmed = false">
            Keep them
          </button>
          <button type="button" class="paper-btn return-discard-go" @click="discard">
            Discard these notes
          </button>
        </template>
        <template v-else>
          <button type="button" class="paper-btn return-discard" @click="discardArmed = true">
            Discard…
          </button>
          <button type="button" class="paper-btn" @click="commit">
            Decide later
          </button>
          <button type="button" class="paper-btn primary" @click="commit">
            Finish · save {{ decisions.acceptedCount.value }} accepted
          </button>
        </template>
      </footer>
    </section>
  </div>
</template>

<style scoped src="./coach-return-sheet.css"></style>
