<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { GetCoachingSettings } from '@/api-client'
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
async function prefillHandle(): Promise<void> {
  try {
    const settings = await GetCoachingSettings()
    if (handle.value === '') handle.value = settings.player_handle ?? ''
  } catch { /* the field is editable; a failed prefill is not an error */ }
}

watch(shareOpen, (open) => {
  if (!open) return
  handle.value = ''
  message.value = ''
  filename.value = defaultFilename()
  void prefillHandle()
})

const needsHandle = computed(() => handle.value.trim() === '')
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

      <div class="sheet-body">
        <label class="send-to-coach-field-label" for="send-to-coach-handle">
          Your handle (required)
        </label>
        <input
          id="send-to-coach-handle"
          v-model="handle"
          class="send-to-coach-input"
          type="text"
          maxlength="64"
          placeholder="the name your coach knows you by"
          spellcheck="false"
          autocomplete="off"
          autocorrect="off"
        >

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

        <p class="send-to-coach-summary">
          {{ shareSummary }}
        </p>
        <!-- One row per match, so a gap is a match with a name rather than a
             number in a warning box. -->
        <ul class="send-to-coach-manifest" aria-label="Matches going to your coach">
          <li
            v-for="row in shareManifest"
            :key="row.matchKey"
            class="send-to-coach-row"
            :class="{ 'is-missing': row.replayCode === '' }"
          >
            <span class="send-to-coach-row-label">{{ row.label }}</span>
            <span v-if="row.replayCode" class="send-to-coach-code">{{ row.replayCode }}</span>
            <span v-else class="send-to-coach-gap">no replay code</span>
          </li>
        </ul>

        <div v-if="shareMissing.length" class="send-to-coach-fix" role="alert">
          <p class="send-to-coach-fix-line">
            A coach cannot load a match without its replay code. Add each one in
            the match's journal, then send.
          </p>
          <button type="button" class="btn ghost" @click="matches.showMissingOnMatches()">
            Show {{ shareMissing.length === 1 ? 'it' : `the ${shareMissing.length}` }} on Matches →
          </button>
        </div>

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
          :title="blockedReason"
          data-testid="send-to-coach-submit"
        >
          {{ shareBusy ? 'Sending…' : 'Send' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
/* Shape comes from the .sheet-* family in styles/system-alert.css — capped,
   pinned head and actions, only the middle scrolls, so Send is one click
   away at every window height. Only the width is this dialog's own. */
.send-to-coach-box {
  width: min(32rem, 100%);
}

.send-to-coach-title {
  margin: 0.2rem 0 0;
  font-family: var(--display);
  font-size: var(--type-7xl);
  font-style: italic;
  font-weight: 800;
  line-height: 1;
  color: var(--text);
  text-transform: uppercase;
}

.send-to-coach-subject {
  margin: 0.25rem 0 0.9rem;
  font-size: var(--type-lg);
  color: var(--text-dim);
}

.send-to-coach-field-label {
  display: block;
  margin: 0.9rem 0 0.25rem;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.send-to-coach-input {
  width: 100%;
  padding: 0.45rem 0.55rem;
  font-family: var(--body);
  font-size: var(--type-lg);
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
}

.send-to-coach-message {
  line-height: 1.45;
  resize: vertical;
}

.send-to-coach-summary {
  margin: 1rem 0 0.3rem;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.send-to-coach-manifest {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.send-to-coach-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.2rem 0.4rem;
  border-radius: var(--radius);
  font-size: var(--type-md);
  color: var(--text-dim);
}

.send-to-coach-row.is-missing {
  color: var(--text);
  background: var(--loss-soft);
}

.send-to-coach-row-label {
  min-width: 0;
}

.send-to-coach-code {
  flex: none;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.08em;
  color: var(--text-faint);
}

.send-to-coach-gap {
  flex: none;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--loss);
}

.send-to-coach-fix {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.4rem;
  margin-top: 0.6rem;
  padding: 0.55rem 0.7rem;
  border-left: 2px solid var(--loss);
  background: var(--loss-soft);
  border-radius: var(--radius);
}

.send-to-coach-fix-line {
  margin: 0;
  font-size: var(--type-md);
  color: var(--text);
}

.send-to-coach-warn {
  margin: 1rem 0 0;
  padding-left: 0.7rem;
  border-left: 2px solid var(--accent);
  font-size: var(--type-md);
  line-height: 1.5;
  color: var(--text-dim);
}

.send-to-coach-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.1rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--border-soft);
}

.send-to-coach-cancel,
.send-to-coach-send {
  appearance: none;
  padding: 0.4rem 0.9rem;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-radius: var(--radius);
  cursor: pointer;
}

.send-to-coach-cancel {
  color: var(--text-dim);
  background: transparent;
  border: 1px solid var(--border-soft);
}

.send-to-coach-send {
  color: var(--primary-text-on-accent);
  background: var(--accent);
  border: 1px solid var(--accent);
}

.send-to-coach-send:disabled,
.send-to-coach-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
