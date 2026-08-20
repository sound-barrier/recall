<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from 'vue'

import { GetCoachingSettings } from '@/api-client'
import { useScrollLock } from '@/composables/shared/keyboard/useScrollLock'
import type { ExportBundleRequest } from '@/composables/matches/useExportBundle'

// Selection-aware "Export bundle" modal. Opens from the MatchesView
// bulk-action bar. Lets the user:
//   * confirm the destination filename (defaulted to
//     recall-bundle-<timestamp>.zip),
//   * optionally add every hidden match to the checkbox selection,
//   * optionally add every unknown match to the checkbox selection,
//   * or SHARE the same selection with a coach, which names the player in
//     the manifest so the file opens as a coaching session.
// Submits with the final knobs; useExportBundle dispatches the actual save
// via api.ts ExportBundle (Wails native dialog or browser blob).
//
// The two modes are deliberately hard to confuse: sharing renames the
// dialog, the submit button and the default filename, because a player who
// cannot tell which file they just made will hand a coach the wrong one.
//
// Esc / backdrop click both dismiss (unlike the first-run modal,
// this is a soft prompt). Focus trap cycles inside the box.

const props = withDefaults(defineProps<{
  open:           boolean
  selectedCount:  number
  hiddenCount:    number
  unknownCount:   number
  /** Open already in share mode — the caller has made the choice. */
  shareIntent?:   boolean
  /**
   * Selected matches with NO replay code, as printable labels. A coach
   * reviews by watching the replay, so share mode refuses while any match
   * going out lacks one (the server says the same 409); plain exports
   * ignore these entirely, and a self review never needs a code.
   */
  missingReplay?: readonly string[]
  /** Code-less counts among the toggled-in extras, weighed only while their toggle is on. */
  hiddenMissingReplay?:  number
  unknownMissingReplay?: number
}>(), { shareIntent: false, missingReplay: () => [], hiddenMissingReplay: 0, unknownMissingReplay: 0 })

const emit = defineEmits<{
  close: []
  // Caller threads the request into its ExportBundle call. Filename is what
  // the user typed (empty string allowed — the caller falls back to the
  // timestamp default); `share` is null for a plain export.
  export: [request: ExportBundleRequest]
}>()

// Freeze the page behind the modal (this one wires its own focus trap
// rather than useModalFocusTrap, so it locks scroll directly).
useScrollLock(toRef(props, 'open'))

function defaultFilename(sharing = false): string {
  // Same shape the server emits via Content-Disposition. Local-time
  // is intentional: the user is naming a file they'll find in their
  // own Finder/Explorer, so the local timestamp reads more
  // naturally than UTC. The stem differs by mode so the two files are
  // told apart in a folder weeks later.
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `recall-${sharing ? 'share' : 'bundle'}-` +
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip`
  )
}

// The name we last generated, kept so mode switches can re-stem it without
// overwriting one the user typed.
const generatedName  = ref(defaultFilename())
const filename       = ref(generatedName.value)
const includeHidden  = ref(false)
const includeUnknown = ref(false)
const sharing        = ref(false)
const shareHandle    = ref('')

// Best-effort: a share can still be typed by hand, so a settings read that
// fails must not stop the dialog opening.
async function storedPlayerHandle(): Promise<string> {
  try {
    return (await GetCoachingSettings()).player_handle
  } catch (_) {
    return ''
  }
}
const shareMessage   = ref('')
const busy           = ref(false)

function seedFilename(sharingNow: boolean): void {
  const untouched = filename.value === generatedName.value
  generatedName.value = defaultFilename(sharingNow)
  if (untouched) filename.value = generatedName.value
}

watch(sharing, seedFilename)

// Declared ahead of the open-watch below: that watch runs immediately
// (see its note), so both refs must already be initialized when it does.
const inputEl = ref<HTMLInputElement | null>(null)
const lastFocus = ref<HTMLElement | null>(null)

// Reset every time the modal re-opens so a previous run's toggles
// don't surprise the user.
//
// `immediate` is load-bearing, not tidiness: this component is a
// defineAsyncComponent overlay, so it can mount with `open` ALREADY
// true (the chunk resolving after the user clicked "Export bundle…").
// Without it the open transition is never observed on that path and the
// Esc handler, the Tab trap, and the focus hand-off are all never wired.
// An immediate run with open=false is a no-op: `prev` is undefined, so
// the close branch below can't fire either.
watch(() => props.open, async (next, prev) => {
  if (next) {
    generatedName.value  = defaultFilename()
    filename.value       = generatedName.value
    includeHidden.value  = false
    includeUnknown.value = false
    sharing.value        = props.shareIntent
    shareHandle.value    = ''
    // Filled in from the server, not awaited: the handle is stored the first
    // time someone shares, and asking for it again every time was friction on
    // a value the app already had. Awaiting it here would put the dialog's
    // focus behind a network call, and only fill a field the user has not
    // reached yet — so it lands when it lands, and never over anything typed
    // in the meantime.
    void storedPlayerHandle().then((handle) => {
      if (props.open && !shareHandle.value) shareHandle.value = handle
    })
    shareMessage.value   = ''
    busy.value           = false
    lastFocus.value =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', onKeydown)
    await nextTick()
    inputEl.value?.focus({ preventScroll: true })
  } else if (prev) {
    document.removeEventListener('keydown', onKeydown)
    await nextTick()
    lastFocus.value?.focus()
    lastFocus.value = null
  }
}, { immediate: true })

// Final count includes the checkbox selection plus the toggled-in
// sets. Doesn't dedupe (the backend handles dedup), but the rough
// preview number is what the user wants to see.
const previewCount = computed(() => {
  let n = props.selectedCount
  if (includeHidden.value)  n += props.hiddenCount
  if (includeUnknown.value) n += props.unknownCount
  return n
})

// Every code-less match the CURRENT toggles would send.
const missingReplayCount = computed(() => {
  if (!sharing.value) return 0
  let n = props.missingReplay.length
  if (includeHidden.value)  n += props.hiddenMissingReplay
  if (includeUnknown.value) n += props.unknownMissingReplay
  return n
})

const canSubmit = computed(() => {
  if (busy.value) return false
  if (sharing.value && shareHandle.value.trim() === '') return false
  if (missingReplayCount.value > 0) return false
  return previewCount.value > 0
})

// A disabled button that will not say why is a dead end — the reason rides
// its title, and the empty-handle case is the one a player actually hits.
const submitBlockedReason = computed(() => {
  if (busy.value || canSubmit.value) return undefined
  if (sharing.value && shareHandle.value.trim() === '') {
    return 'Enter the handle your coach knows you by — the bundle is signed with it.'
  }
  if (missingReplayCount.value > 0) {
    return 'Every match going to a coach needs a replay code — add each one in the match\'s journal.'
  }
  return 'Nothing selected to export.'
})

// The gaps the note prints — a handful is enough to act on.
const missingReplayPreview = computed(() => props.missingReplay.slice(0, 4))

// Everything that tells the two modes apart on screen, in one place.
const title = computed(() => (sharing.value ? 'Share with a coach' : 'Export bundle'))
const submitLabel = computed(() => (sharing.value ? 'Share' : 'Export'))
const busyLabel = computed(() => (sharing.value ? 'Sharing…' : 'Exporting…'))

async function onSubmit() {
  if (!canSubmit.value) return
  busy.value = true
  try {
    emit('export', {
      filename: filename.value.trim(),
      includeHidden: includeHidden.value,
      includeUnknown: includeUnknown.value,
      share: sharing.value
        ? { handle: shareHandle.value.trim(), message: shareMessage.value.trim() }
        : null,
    })
  } finally {
    busy.value = false
  }
}

function onCancel() {
  if (busy.value) return
  emit('close')
}

function focusable(): HTMLElement[] {
  const box = document.querySelector<HTMLElement>('.export-bundle-modal-box')
  if (!box) return []
  const sel = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return Array.from(box.querySelectorAll<HTMLElement>(sel))
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    onCancel()
    return
  }
  if (e.key !== 'Tab') return
  const items = focusable()
  if (items.length === 0) return
  const first = items[0]!
  const last  = items[items.length - 1]!
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

onBeforeUnmount(() => {
  // The open-watch owns add/remove; this covers unmount-while-open.
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    v-if="open"
    class="export-bundle-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="export-bundle-title"
    aria-describedby="export-bundle-desc"
    data-testid="export-bundle-modal"
  >
    <div class="export-bundle-modal-backdrop" aria-hidden="true" @click="onCancel" />
    <form
      class="export-bundle-modal-box"
      @submit.prevent="onSubmit"
    >
      <p class="eyebrow accent export-bundle-eyebrow">
        {{ sharing ? 'Coaching' : 'Data & Export' }}
      </p>
      <h2 id="export-bundle-title" class="export-bundle-title">
        {{ title }}
      </h2>
      <!--
        Share mode ADDS to the plain description, it does not replace it. The
        sentence naming the screenshots used to disappear the moment the box
        was ticked — so the one fact a person needs before handing a file to
        another human ("this contains scoreboards, with everyone's BattleTag")
        was off screen exactly when they were deciding to do it.
      -->
      <p id="export-bundle-desc" class="export-bundle-desc">
        A <code>.zip</code> containing each match's JSON data and
        every referenced screenshot.
        <template v-if="!sharing">
          Restores via Settings → Backup &amp; Restore.
        </template>
      </p>
      <p v-if="sharing" class="export-bundle-desc export-bundle-warn">
        Stamped with your name so your coach can open it as a session, and
        their notes come back as a file you decide on, match by match. It also
        carries everything you wrote about these matches — your notes and
        moments, your own reviews of them, the tags and squads, replay codes,
        and who you marked as leaving or throwing — plus any review an earlier
        coach sent back. The screenshots show every player's BattleTag. Send
        fewer matches to share less.
      </p>

      <div class="export-bundle-body">
        <div class="export-bundle-row">
          <span class="export-bundle-label">Selected matches</span>
          <span class="export-bundle-value">{{ selectedCount }}</span>
        </div>

        <label class="export-bundle-toggle">
          <input
            v-model="includeUnknown"
            type="checkbox"
            :disabled="unknownCount === 0"
            data-testid="include-unknown"
          >
          <span>
            Include
            <strong>{{ unknownCount }}</strong>
            unknown match{{ unknownCount === 1 ? '' : 'es' }}
          </span>
        </label>

        <label class="export-bundle-toggle">
          <input
            v-model="includeHidden"
            type="checkbox"
            :disabled="hiddenCount === 0"
            data-testid="include-hidden"
          >
          <span>
            Include
            <strong>{{ hiddenCount }}</strong>
            hidden match{{ hiddenCount === 1 ? '' : 'es' }}
          </span>
        </label>

        <label class="export-bundle-toggle export-bundle-share-toggle">
          <input v-model="sharing" type="checkbox">
          <span>Share with a coach</span>
        </label>

        <div v-if="sharing" class="export-bundle-share">
          <label class="export-bundle-field-label" for="export-bundle-handle">
            Your handle (required)
          </label>
          <input
            id="export-bundle-handle"
            v-model="shareHandle"
            type="text"
            class="export-bundle-input"
            autocomplete="off"
            spellcheck="false"
            aria-required="true"
            placeholder="The name your coach knows you by"
          >
          <label class="export-bundle-field-label" for="export-bundle-message">
            Message for your coach (optional)
          </label>
          <textarea
            id="export-bundle-message"
            v-model="shareMessage"
            class="export-bundle-input export-bundle-message"
            rows="3"
            placeholder="What do you want them to look at?"
          />
          <!-- A coach reviews by WATCHING the replay — a bundle they cannot
               load hands them nothing to review. The note names the gaps and
               where the code goes; the server refuses the same share with a
               409, so this is the honest gate, not a nag. -->
          <div v-if="missingReplayCount > 0" class="export-bundle-missing-replay" role="alert">
            <p class="export-bundle-missing-line">
              {{ missingReplayCount }} of these matches {{ missingReplayCount === 1 ? 'has' : 'have' }} no replay
              code — a coach can't watch what they can't load. Add each code in
              the match's journal (Replay code field), then share.
            </p>
            <ul v-if="missingReplayPreview.length" class="export-bundle-missing-list">
              <li v-for="label in missingReplayPreview" :key="label">
                {{ label }}
              </li>
              <li v-if="missingReplay.length > missingReplayPreview.length">
                …and {{ missingReplay.length - missingReplayPreview.length }} more
              </li>
            </ul>
          </div>
        </div>

        <label class="export-bundle-field-label" for="export-bundle-filename">
          Filename
        </label>
        <input
          id="export-bundle-filename"
          ref="inputEl"
          v-model="filename"
          type="text"
          class="export-bundle-input"
          autocomplete="off"
          spellcheck="false"
          required
          :disabled="busy"
          data-testid="filename"
        >

        <p class="export-bundle-preview">
          Bundle will include ~
          <strong>{{ previewCount }}</strong>
          match{{ previewCount === 1 ? '' : 'es' }} total.
        </p>
      </div>

      <div class="export-bundle-actions">
        <button
          type="button"
          class="export-bundle-cancel"
          :disabled="busy"
          @click="onCancel"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="export-bundle-save"
          :disabled="!canSubmit"
          :title="submitBlockedReason"
          data-testid="export-submit"
        >
          {{ busy ? busyLabel : submitLabel }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.export-bundle-missing-replay {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.5rem 0.65rem;
  margin-top: 0.5rem;
  background: var(--loss-soft);
  border: 1px solid var(--loss);
  border-radius: var(--radius);
}

.export-bundle-missing-line {
  margin: 0;
  font-size: var(--type-md);
  line-height: 1.45;
  color: var(--text);
}

.export-bundle-missing-list {
  margin: 0;
  padding-left: 1.1rem;
  font-family: var(--mono);
  font-size: var(--type-xs);
  color: var(--text-dim);
}

/* The overlay scrolls too, as a second line of defence. `align-items: center`
   pushes an over-tall box off BOTH edges and the top half is then unreachable
   — so the box is capped below, and this is what catches anything the cap
   cannot (a user-resized textarea, a font-size bump). ManualMatchModal does
   the same. */
.export-bundle-modal {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  overflow-y: auto;
}

/* The only thing that scrolls. useScrollLock cancels any wheel that does not
   land in an `overflow-y: auto` element, so without this rule the modal was
   not merely clipped — it was completely inert to the wheel. */
.export-bundle-body {
  flex: 1 1 auto;

  /* Load-bearing: a flex item's default `min-height: auto` refuses to shrink
     below its content, which would defeat the cap above entirely. */
  min-height: 0;
  overflow-y: auto;
}

/* Neither the title nor the way out may be squeezed by a tall body. */
.export-bundle-eyebrow,
.export-bundle-title,
.export-bundle-desc,
.export-bundle-actions {
  flex: 0 0 auto;
}

.export-bundle-modal-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  backdrop-filter: blur(2px);
}

/* Capped to the viewport as a flex column: the eyebrow and title above, the
   actions row below, and only the middle scrolls. A dialog whose Cancel
   button is off-screen is a trap, which is what this was in share mode at
   any window under ~840px. Mirrors SettingsModal. */
.export-bundle-modal-box {
  position: relative;
  z-index: 1;
  width: min(30rem, 100%);
  max-height: calc(100dvh - 3rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  padding: 1.6rem 1.6rem 1.3rem;
  box-shadow:
    0 22px 60px color-mix(in srgb, var(--bg) 70%, transparent),
    0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
}

.export-bundle-eyebrow {
  margin: 0 0 0.3rem;
}

.export-bundle-title {
  margin: 0 0 0.6rem;
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: var(--type-7xl);
  font-style: italic;
  letter-spacing: 0.02em;
  color: var(--text);
}

.export-bundle-desc {
  margin: 0 0 1rem;
  font-size: var(--type-lg);
  color: var(--text-faint);
  line-height: 1.5;
}

/* What leaves the machine, stated where the decision is made. --text-dim
   rather than --text-faint: this is the paragraph that must be read, not the
   one that may be skimmed. */
.export-bundle-warn {
  padding-left: 0.7rem;
  color: var(--text-dim);
  border-left: 2px solid var(--accent);
}

.export-bundle-desc code {
  font-family: var(--mono);
  font-size: var(--type-md);
  padding: 0.05rem 0.3rem;
  background: var(--surface-2);
  border-radius: var(--radius);
}

.export-bundle-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0.5rem;
}

.export-bundle-label {
  font-family: var(--mono);
  font-size: var(--type-2xs);
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.export-bundle-value {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: var(--type-3xl);
  font-style: italic;
  color: var(--text);
}

.export-bundle-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.35rem 0;
  font-size: var(--type-lg);
  color: var(--text);
  cursor: pointer;
}

.export-bundle-toggle input[type="checkbox"] {
  accent-color: var(--accent);
  width: 16px;
  height: 16px;
}

.export-bundle-toggle input:disabled + span {
  opacity: 0.5;
  cursor: not-allowed;
}

/* The mode switch sits apart from the two "include…" rows: it changes what
   the file IS, not what goes in it. */
.export-bundle-share-toggle {
  margin-top: 0.5rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--border);
  font-weight: 700;
}

.export-bundle-share {
  padding: 0.2rem 0 0.2rem 0.7rem;
  border-left: 2px solid var(--accent);
}

/* Resizable, and safely so now: the box is capped and the body scrolls, so
   dragging this taller just gives the body something to scroll rather than
   pushing the dialog off screen. Before the cap it was a one-way trap. */
.export-bundle-message {
  font-family: var(--body);
  line-height: 1.45;
  resize: vertical;
}

.export-bundle-field-label {
  display: block;
  margin: 0.8rem 0 0.3rem;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.export-bundle-input {
  width: 100%;
  padding: 0.55rem 0.7rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: var(--mono);
  font-size: var(--type-lg);
  color: var(--text);
}

.export-bundle-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}

.export-bundle-preview {
  margin: 0.8rem 0 0;
  font-size: var(--type-md);
  color: var(--text-faint);
}

.export-bundle-preview strong {
  color: var(--accent-text);
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: var(--type-2xl);
  font-style: italic;
}

.export-bundle-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: 1.1rem;
}

.export-bundle-cancel,
.export-bundle-save {
  appearance: none;
  font-family: var(--mono);
  font-size: var(--type-sm);
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.5rem 0.95rem;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--duration-fast) ease, color var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

.export-bundle-cancel {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-faint);
}

.export-bundle-cancel:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong);
}

.export-bundle-save {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: var(--primary-text-on-accent);
}

.export-bundle-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
