<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { RenameProfile, type ProfilesResponse } from '../api'

// First-run "Main account name" modal. Forced gate — ESC and
// backdrop clicks do NOT dismiss it. The user must either:
//   1. Type a name + Save → renames the default `main` profile, OR
//   2. "Keep as main" → records the acknowledgement so the modal
//      doesn't reappear on next launch.
//
// Both paths flip the localStorage flag `recall.firstRunAccountNamed`
// so subsequent launches skip the modal. The parent (App.vue) gates
// rendering on that flag's absence.

const emit = defineEmits<{
  // Fires when the user dismisses the modal (either path). The parent
  // sets the localStorage flag and unmounts.
  'dismiss': [renamedTo: string | null]
}>()

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/

const inputValue = ref('')
const busy       = ref(false)
const error      = ref<string | null>(null)

const inputValid = computed(() => NAME_RE.test(inputValue.value))
const inputDirty = computed(() => inputValue.value.length > 0)

const inputEl = ref<HTMLInputElement | null>(null)

async function onSave() {
  if (busy.value || !inputValid.value) return
  busy.value = true
  error.value = null
  try {
    const next = inputValue.value.trim()
    const _resp: ProfilesResponse = await RenameProfile('main', next)
    emit('dismiss', next)
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}

function onKeepDefault() {
  if (busy.value) return
  emit('dismiss', null)
}

// Focus trap — Tab + Shift+Tab cycle inside the modal box. We do NOT
// install an ESC handler: the modal is a forced gate. Backdrop
// clicks are absorbed by the modal box (no @click on the backdrop).
function focusable(): HTMLElement[] {
  const box = document.querySelector<HTMLElement>('.first-run-modal-box')
  if (!box) return []
  const sel = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return Array.from(box.querySelectorAll<HTMLElement>(sel))
}

function onKeydown(e: KeyboardEvent) {
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

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  await nextTick()
  inputEl.value?.focus({ preventScroll: true })
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    class="first-run-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="first-run-title"
    aria-describedby="first-run-desc"
  >
    <!-- Backdrop intentionally absorbs clicks without a handler — this
         is a forced gate, not a soft prompt. -->
    <div class="first-run-modal-backdrop" aria-hidden="true" />
    <form
      class="first-run-modal-box"
      @submit.prevent="onSave"
    >
      <p class="first-run-eyebrow">
        Welcome to Recall
      </p>
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
      >
      <p v-if="inputDirty && !inputValid" class="first-run-hint">
        a–z, 0–9, _ or -, 1–40 chars, start with a letter or digit.
      </p>
      <p v-if="error" class="first-run-error">
        {{ error }}
      </p>
      <div class="first-run-actions">
        <button
          type="button"
          class="first-run-keep"
          :disabled="busy"
          @click="onKeepDefault"
        >
          Keep as "main"
        </button>
        <button
          type="submit"
          class="first-run-save"
          :disabled="busy || !inputValid"
        >
          {{ busy ? 'Saving…' : 'Save' }}
        </button>
      </div>
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

.first-run-eyebrow {
  margin: 0 0 0.3rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent-text);
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
.first-run-error { color: var(--loss, #e74c3c); }

.first-run-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.1rem;
}

.first-run-keep,
.first-run-save {
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

.first-run-keep {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-faint);
}

.first-run-keep:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong, var(--text-faint));
}

.first-run-save {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: var(--primary-text-on-accent, var(--bg));
}

.first-run-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
