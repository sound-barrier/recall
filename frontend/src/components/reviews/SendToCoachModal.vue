<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { useCoachingSettingsQuery } from '@/queries/settings'
import { useModalFocusTrap } from '@/composables/shared/keyboard/useModalFocusTrap'
import { useMatchesStore } from '@/stores/matches'

// Sending matches to a coach.
//
// This used to be a checkbox inside a dialog labeled for backups, which is
// why nobody found it. It is its own dialog now, and because sharing is the
// whole job rather than a mode, the replay-code requirement can be what it
// should always have been: not a disabled button with an explanation in its
// title, but a manifest of exactly what is going out with the gaps named.
//
// Reads the store directly and takes no props — the overlay cluster's rule
// (frontend/CLAUDE.md), and it takes the replay-gap math out of AppOverlays,
// which is chrome and had no business owning it.

const matches = useMatchesStore()
const {
  shareOpen, shareBusy, shareManifest, shareMissing,
  shareSummary, shareSubject, shareBlocked,
} = storeToRefs(matches)

const handle = ref('')
const message = ref('')
const filename = ref('')

function defaultFilename(): string {
  // Local time on purpose: this names a file the sender will look for in
  // their own Finder or Explorer weeks later.
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `recall-share-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip`
}

// Prefilled best-effort from the handle already on file, and deliberately
// not awaited: the dialog opens now, and the prefill lands when it lands —
// never over something already typed.
//
// Read through the shared query rather than fetched here, so the handle is
// the one Settings last saved. The two used to fetch independently and agreed
// only because this dialog re-fetched every time it opened.
const coachingSettings = useCoachingSettingsQuery()

async function prefillHandle(): Promise<void> {
  try {
    const settings = coachingSettings.data.value
      ?? await coachingSettings.suspense().then(() => coachingSettings.data.value)
    if (handle.value === '') handle.value = settings?.player_handle ?? ''
  } catch { /* the field is editable; a failed prefill is not an error */ }
}

// `immediate: true` because this component is lazy-loaded and rendered
// unconditionally: a share requested before its chunk resolves mounts it with
// shareOpen ALREADY true, and a plain watcher never runs. The filename would
// stay empty and the server would fall back to the BACKUP name — handing a
// coach a file named like a backup is the confusion this dialog exists to end.
// useModalFocusTrap carries the same note for the same reason.
watch(shareOpen, (open) => {
  if (!open) return
  // The stash survives the "Show the N on Matches" round-trip — a player
  // who typed a message, found the block, and took the door to fix it must
  // not come back to an empty dialog. An explicit Cancel or a successful
  // send cleared it (the composable owns those endings).
  const stash = matches.shareDraft
  handle.value = stash?.handle ?? ''
  message.value = stash?.message ?? ''
  filename.value = defaultFilename()
  if (handle.value === '') void prefillHandle()
  void nextTick(measureScroll)
}, { immediate: true })

// Every keystroke updates the stash; the composable decides when it dies.
watch([handle, message], ([h, m]) => {
  if (shareOpen.value) matches.stashShareDraft({ handle: h, message: m })
})

// ── The fold cue ─────────────────────────────────────────────────────
// The pinned-actions design guarantees the manifest is cut at some window
// height, and thin overlay scrollbars make the cut invisible — so the
// scroll region itself says when there is more below the fold.
const sheetBody = useTemplateRef<HTMLElement>('sheetBody')
const moreBelow = ref(false)

function measureScroll(): void {
  const el = sheetBody.value
  if (!el) return
  moreBelow.value = el.scrollTop + el.clientHeight < el.scrollHeight - 1
}


// The manifest is one row per match and `narrow` can be the whole corpus, so
// it is capped. The count above it is the whole truth; these rows exist to make
// a gap NAMEABLE, and a name you have to scroll past hundreds of others to
// reach is not one.
const MANIFEST_ROWS_SHOWN = 12
const shownManifest = computed(() => shareManifest.value.slice(0, MANIFEST_ROWS_SHOWN))
const hiddenManifestCount = computed(() =>
  Math.max(0, shareManifest.value.length - MANIFEST_ROWS_SHOWN))

const needsHandle = computed(() => handle.value.trim() === '')

// The fold moves without a scroll: a window resize, the fix box leaving
// after a refetch, the handle hint appearing. Each re-measures — a cue
// that only answered the open moment went stale in exactly the case it
// exists for.
onMounted(() => window.addEventListener('resize', measureScroll))
onUnmounted(() => window.removeEventListener('resize', measureScroll))
watch([shareManifest, shareMissing, needsHandle], () => {
  void nextTick(measureScroll)
})
const canSend = computed(() =>
  !shareBusy.value && shareBlocked.value === undefined && !needsHandle.value)

const blockedReason = computed(() => {
  if (shareBusy.value || canSend.value) return undefined
  if (needsHandle.value) return 'Enter the handle your coach knows you by — the bundle is signed with it.'
  return shareBlocked.value
})

useModalFocusTrap(shareOpen, {
  containerSelector: '.send-to-coach-box',
  onClose: () => matches.closeShare(),
  keepOpenOnFieldEscape: true,
})

function onSend(): void {
  if (!canSend.value) return
  void matches.confirmShare({
    handle: handle.value.trim(),
    message: message.value.trim(),
    filename: filename.value.trim(),
  })
}
</script>

<template>
  <div
    v-if="shareOpen"
    class="sheet-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="send-to-coach-title"
    data-testid="send-to-coach"
  >
    <div class="sheet-backdrop" aria-hidden="true" @click="matches.closeShare()" />
    <form class="sheet-box send-to-coach-box" @submit.prevent="onSend">
      <p class="eyebrow accent sheet-fixed send-to-coach-eyebrow">
        Coaching
      </p>
      <h2 id="send-to-coach-title" class="sheet-fixed send-to-coach-title">
        Send to a coach
      </h2>
      <p class="sheet-fixed send-to-coach-subject">
        {{ shareSubject }}
      </p>

      <div ref="sheetBody" class="sheet-body" @scroll.passive="measureScroll">
        <label class="send-to-coach-field-label" for="send-to-coach-handle">
          Your handle (required)
        </label>
        <input
          id="send-to-coach-handle"
          v-model="handle"
          class="send-to-coach-input"
          type="text"
          maxlength="64"
          aria-required="true"
          :aria-describedby="needsHandle ? 'send-to-coach-handle-hint' : undefined"
          placeholder="the name your coach knows you by"
          spellcheck="false"
          autocomplete="off"
          autocorrect="off"
        >
        <!-- The requirement beside the field it names, not only in the
             footer: the footer line is the least prominent text in the
             dialog and nowhere near the thing to fix. -->
        <p
          v-if="needsHandle"
          id="send-to-coach-handle-hint"
          class="send-to-coach-field-hint"
        >
          The bundle is signed with this — Send stays off until it has a name.
        </p>

        <label class="send-to-coach-field-label" for="send-to-coach-message">
          Message for your coach (optional)
        </label>
        <textarea
          id="send-to-coach-message"
          v-model="message"
          class="send-to-coach-input send-to-coach-message"
          rows="3"
          maxlength="2000"
          placeholder="What do you want them to look at?"
          spellcheck="true"
          autocorrect="off"
        />

        <!-- Above the manifest, deliberately. The manifest is one row per
             match and a wide narrow is hundreds of them, so anything below it
             is off screen at the moment the user decides to send — and this is
             the one fact a person needs BEFORE handing a file to another
             human. The dialog this replaced learned that the hard way. -->
        <p class="send-to-coach-warn">
          The bundle carries these matches whole — your journal notes, moments,
          tags, squads, BattleTags, replay codes and any reviews a coach has
          already sent back. It is signed with your handle. Send it only to
          someone you mean to show all of that.
        </p>

        <label class="send-to-coach-field-label" for="send-to-coach-filename">
          Save as
        </label>
        <input
          id="send-to-coach-filename"
          v-model="filename"
          class="send-to-coach-input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          autocorrect="off"
          data-testid="send-to-coach-filename"
        >

        <div v-if="shareMissing.length" class="send-to-coach-fix" role="alert">
          <p class="send-to-coach-fix-line">
            A coach cannot load a match without its replay code. Add each one in
            the match's journal, then send.
          </p>
          <button type="button" class="btn ghost" @click="matches.showMissingOnMatches()">
            Show {{ shareMissing.length === 1 ? 'it' : `the ${shareMissing.length}` }} on Matches →
          </button>
        </div>

        <p class="send-to-coach-summary">
          {{ shareSummary }}
        </p>
        <!-- One row per match, so a gap is a match with a name rather than a
             number in a warning box. Capped, because the set can be the whole
             narrow: the point of the list is to make the gaps nameable, and
             the fix box above already counts them all. -->
        <ul class="send-to-coach-manifest" aria-label="Matches going to your coach">
          <li
            v-for="row in shownManifest"
            :key="row.matchKey"
            class="send-to-coach-row"
            :class="{ 'is-missing': row.replayCode === '' }"
          >
            <span class="send-to-coach-row-label">{{ row.label }}</span>
            <span v-if="row.replayCode" class="send-to-coach-code">{{ row.replayCode }}</span>
            <span v-else class="send-to-coach-gap">no replay code</span>
          </li>
        </ul>
        <p v-if="hiddenManifestCount > 0" class="send-to-coach-more">
          …and {{ hiddenManifestCount }} more
        </p>
        <div
          v-show="moreBelow"
          class="send-to-coach-scroll-cue"
          aria-hidden="true"
        />
      </div>

      <div class="sheet-fixed send-to-coach-actions">
        <button
          type="button"
          class="send-to-coach-cancel"
          :disabled="shareBusy"
          @click="matches.closeShare()"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="send-to-coach-send"
          :disabled="!canSend"
          :aria-describedby="blockedReason ? 'send-to-coach-blocked' : undefined"
          data-testid="send-to-coach-submit"
        >
          {{ shareBusy ? 'Sending…' : 'Send' }}
        </button>
      </div>
      <!-- Visible text, not a title on a disabled button: a title there is
           announced by nothing and shown on hover a mouse cannot deliver. -->
      <p
        v-if="blockedReason"
        id="send-to-coach-blocked"
        class="sheet-fixed send-to-coach-blocked"
        role="status"
      >
        {{ blockedReason }}
      </p>
    </form>
  </div>
</template>

<style scoped src="./send-to-coach-modal.css"></style>
