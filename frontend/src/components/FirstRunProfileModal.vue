<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { RenameProfile, type NamedCandidate, type ProfilesResponse } from '@/api'
import { useModalFocusTrap } from '@/composables/useModalFocusTrap'
import ScreenshotSourcePicker from '@/components/ScreenshotSourcePicker.vue'

// First-run modal. Two steps:
//   1. Name the main account so the masthead chip + per-profile data
//      tree have a meaningful label (the user can tell their main from
//      a future alt or smurf).
//   2. Point Recall at a screenshots folder so the first parse run can
//      land somewhere — inlined here instead of dumping the user onto
//      a blank Settings hero with a Files card.
//
// Forced gate. Escape is intercepted but does NOT dismiss. Backdrop
// clicks fall through to a no-op (the inner box absorbs without a
// handler).
//
// Step 2 is skippable — a user can still configure the folder on
// Settings later. The modal emits dismiss + the parent reloads when
// the active profile was renamed (same teardown the masthead chip's
// switch/create/rename flow does).

const props = defineProps<{
  // Platform hint forwarded to the picker. 'windows' | 'darwin' |
  // 'linux' | ''. Optional so a Wails build without the platform
  // probe still mounts the modal cleanly.
  platform?: string
  // Per-source candidates list from
  // /api/v1/system/screenshots-folder-candidates. Empty on macOS /
  // Linux — the picker hides the grid there and renders only the
  // custom-pick button.
  candidates: NamedCandidate[]
  // True while the native folder dialog is open. Disables the picker
  // surface so a double-click can't fire two dialogs.
  picking?: boolean
}>()

const emit = defineEmits<{
  // Step 1 / Step 2 final emit. `renamedTo` is the new profile name
  // when the user saved on step 1, null when they kept "main". Parent
  // sets the localStorage ack flag and (when renamedTo is non-null)
  // reloads so the masthead chip rebinds.
  'dismiss': [renamedTo: string | null]
  // Step 2: user clicked a "found" source card. Parent calls
  // SetScreenshotsDir, then this modal dismisses via `dismiss`.
  'pick-source': [path: string]
  // Step 2: user clicked "Pick a different folder…". Parent triggers
  // PickScreenshotsDir; on success it also calls SetScreenshotsDir
  // + ackFirstRun(), which unmounts the modal via the gate prop.
  'pick-custom-source': []
}>()

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/

// ─── Step state machine ─────────────────────────────────────────
type Step = 'name' | 'source'
const step = ref<Step>('name')

// Persisted across the back-button arc — the user can rename, advance
// to step 2, hit Back, see their name typed-in, edit, advance again.
const inputValue = ref('')
const busy       = ref(false)
const error      = ref<string | null>(null)
// What we'll emit on the final dismiss. Carries forward across steps.
const pendingRenamedTo = ref<string | null>(null)

const inputValid = computed(() => NAME_RE.test(inputValue.value))
// `inputDirty` no longer gates the hint — the rules are shown from
// first focus so a first-time user knows the grammar before guessing.
// Still useful for `aria-invalid` so screen readers only flag the
// field as invalid after the user has typed something.
const inputDirty = computed(() => inputValue.value.length > 0)

const inputEl = ref<HTMLInputElement | null>(null)

// ─── Step 1: name ───────────────────────────────────────────────
async function onSave() {
  if (busy.value || !inputValid.value || step.value !== 'name') return
  busy.value = true
  error.value = null
  try {
    const next = inputValue.value.trim()
    const _resp: ProfilesResponse = await RenameProfile('main', next)
    void _resp
    pendingRenamedTo.value = next
    await advanceToSource()
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}

function onKeepDefault() {
  if (busy.value || step.value !== 'name') return
  pendingRenamedTo.value = null
  void advanceToSource()
}

async function advanceToSource() {
  step.value = 'source'
  // Let the picker mount, then move focus to the first focusable
  // inside the new step — typically the first source card or the
  // custom-pick button (when no cards are visible).
  await nextTick()
  const box = document.querySelector<HTMLElement>('.first-run-modal-box')
  const target = box?.querySelector<HTMLElement>(
    '.src-card:not(:disabled), [data-src-pick-custom]',
  )
  target?.focus({ preventScroll: true })
}

// ─── Step 2: picker ─────────────────────────────────────────────
function onPickSource(_name: NamedCandidate['name'], path: string) {
  if (props.picking) return
  emit('pick-source', path)
  // Dismiss immediately — parent has the path; SetScreenshotsDir
  // happens in parallel; reload (when renamedTo !== null) wipes the
  // tree anyway.
  emit('dismiss', pendingRenamedTo.value)
}

function onPickCustomSource() {
  if (props.picking) return
  emit('pick-custom-source')
  // Don't auto-dismiss — wait for the parent's PickScreenshotsDir
  // promise to resolve. If the user cancels the native dialog the
  // modal stays on step 2 so they can try again.
}

function onSkipSource() {
  // User opted to set up the folder later on Settings. Dismiss with
  // whatever rename state we have.
  emit('dismiss', pendingRenamedTo.value)
}

async function onBackToName() {
  step.value = 'name'
  await nextTick()
  inputEl.value?.focus({ preventScroll: true })
}

// ─── Focus trap ─────────────────────────────────────────────────
//
// Adopt useModalFocusTrap with a no-op onClose so Escape gets
// preventDefault'd (preserving the forced-gate contract) but doesn't
// dismiss. Trap is armed for the modal's lifetime — we toggle a
// local ref that mirrors the always-true mount state because
// useModalFocusTrap's API expects a Ref<boolean>.
const trapOpen = ref(true)
useModalFocusTrap(trapOpen, {
  containerSelector: '.first-run-modal-box',
  onClose: () => { /* forced gate — Escape is eaten but doesn't dismiss */ },
})

// Initial focus into the name input. The composable's auto-focus
// targets the first focusable, which is the "Keep as main" button by
// markup order — but we want the name input front-and-centre. Wait
// for the trap's initial-focus tick to land then override.
watch(trapOpen, async (open) => {
  if (open) {
    await nextTick()
    inputEl.value?.focus({ preventScroll: true })
  }
}, { immediate: true })
</script>

<template>
  <div
    class="first-run-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="first-run-title"
    aria-describedby="first-run-desc"
  >
    <div class="first-run-modal-backdrop" aria-hidden="true" />
    <form
      class="first-run-modal-box"
      :data-step="step"
      @submit.prevent="step === 'name' ? onSave() : undefined"
    >
      <p class="first-run-eyebrow">
        <span>Welcome to Recall</span>
        <span
          class="first-run-steps"
          data-testid="first-run-step-label"
        >Step {{ step === 'name' ? 1 : 2 }} of 2</span>
      </p>

      <!-- ─── Step 1: name the main profile ─────────────────── -->
      <template v-if="step === 'name'">
        <h2 id="first-run-title" class="first-run-title">
          Main account name
        </h2>
        <p id="first-run-desc" class="first-run-desc">
          Recall keeps each Overwatch account's match data on its own
          profile. Name your main account so you can tell it apart from
          any alt or smurf profiles you might add later. You can rename
          it any time from the masthead chip.
        </p>
        <label class="first-run-label" for="first-run-input">
          Account name
        </label>
        <input
          id="first-run-input"
          ref="inputEl"
          v-model="inputValue"
          class="first-run-input"
          type="text"
          maxlength="40"
          autocomplete="off"
          spellcheck="false"
          placeholder="e.g. SilentStorm"
          :disabled="busy"
          required
          :aria-invalid="(inputDirty && !inputValid) || !!error ? 'true' : undefined"
          :aria-describedby="error ? 'first-run-error' : (!inputValid ? 'first-run-hint' : undefined)"
        >
        <p
          v-if="!inputValid"
          id="first-run-hint"
          class="first-run-hint"
          :class="{ 'first-run-hint-error': inputDirty }"
        >
          a–z, 0–9, _ or -, 1–40 chars, start with a letter or digit.
        </p>
        <p v-if="error" id="first-run-error" class="first-run-error" role="alert">
          {{ error }}
        </p>
        <div class="first-run-actions">
          <button
            type="button"
            class="first-run-keep"
            :disabled="busy"
            data-step-keep
            @click="onKeepDefault"
          >
            Keep as "main"
          </button>
          <button
            type="submit"
            class="first-run-save"
            :disabled="busy || !inputValid"
            data-step-save
          >
            {{ busy ? 'Saving…' : 'Next' }}
          </button>
        </div>
      </template>

      <!-- ─── Step 2: pick a screenshots folder ─────────────── -->
      <template v-else>
        <h2 id="first-run-title" class="first-run-title">
          Where do your screenshots live?
        </h2>
        <p id="first-run-desc" class="first-run-desc">
          Recall watches a folder for new <code>.png</code> / <code>.jpg</code>
          screenshots and parses them on save. Pick the folder your
          capture tool writes to — you can always change it later in
          Settings.
        </p>
        <ScreenshotSourcePicker
          :platform="platform"
          :candidates="candidates"
          :picking="picking"
          @pick="onPickSource"
          @pick-custom="onPickCustomSource"
        />
        <div class="first-run-actions">
          <button
            type="button"
            class="first-run-keep"
            :disabled="picking"
            data-step-back
            @click="onBackToName"
          >
            ← Back
          </button>
          <button
            type="button"
            class="first-run-skip"
            :disabled="picking"
            data-step-skip
            @click="onSkipSource"
          >
            Skip — set up later
          </button>
        </div>
      </template>
    </form>
  </div>
</template>

<style scoped>
.first-run-modal {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.first-run-modal-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  backdrop-filter: blur(2px);
}

.first-run-modal-box {
  position: relative;
  z-index: 1;
  width: min(28rem, 100%);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 3px;
  padding: 1.6rem 1.6rem 1.3rem;
  box-shadow:
    0 22px 60px color-mix(in srgb, var(--bg) 70%, transparent),
    0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
}

/* Step 2 gets a touch more breathing room for the picker grid. */
.first-run-modal-box[data-step="source"] {
  width: min(32rem, 100%);
}

.first-run-eyebrow {
  margin: 0 0 0.3rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent-text);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.first-run-steps {
  display: inline-flex;
  font-family: var(--mono);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.first-run-title {
  margin: 0 0 0.6rem;
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: 1.6rem;
  font-style: italic;
  letter-spacing: 0.02em;
  color: var(--text);
}

.first-run-desc {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  color: var(--text-faint);
  line-height: 1.5;
}

.first-run-desc code {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text);
}

.first-run-label {
  display: block;
  margin-bottom: 0.3rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.first-run-input {
  width: 100%;
  padding: 0.55rem 0.7rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: 1.1rem;
  letter-spacing: 0.03em;
  color: var(--text);
}

.first-run-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}

.first-run-hint,
.first-run-error {
  margin: 0.4rem 0 0;
  font-family: var(--mono);
  font-size: 0.7rem;
}

.first-run-hint  { color: var(--text-faint); }
.first-run-hint.first-run-hint-error { color: var(--loss, #e74c3c); }
.first-run-error { color: var(--loss, #e74c3c); }

.first-run-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.1rem;
}

/* Step 2's back is on the left, skip on the right. */
.first-run-modal-box[data-step="source"] .first-run-actions {
  justify-content: space-between;
}

.first-run-keep,
.first-run-save,
.first-run-skip {
  appearance: none;
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.5rem 0.95rem;
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}

.first-run-keep,
.first-run-skip {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-faint);
}

.first-run-keep:hover:not(:disabled),
.first-run-skip:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong, var(--text-faint));
}

.first-run-save {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: var(--primary-text-on-accent, var(--bg));
}

.first-run-save:disabled,
.first-run-keep:disabled,
.first-run-skip:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
