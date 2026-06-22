<script setup lang="ts">
import { provide, ref, toRef } from 'vue'
import { ApiError, CreateManualMatch, type MatchRecord } from '@/api-client'
import { useManualMatchForm, manualMatchFormKey } from '@/composables/matches/useManualMatchForm'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'
import ManualMatchForm from '@/components/matches/manual/ManualMatchForm.vue'

// Hand-enter a match for users without OCR. A centered popup modal (solid
// surface over a dimmed page) dressed in the Filter-matches panel's visual
// language. The form body (map/hero pickers + chip toggles + optional fields)
// lives in ManualMatchForm; this shell owns the backdrop, header, footer, focus
// trap, and submit. Submit POSTs via CreateManualMatch; a 409 surfaces inline
// (passed down to the form) without closing.
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; created: [record: MatchRecord] }>()

const f = useManualMatchForm()
provide(manualMatchFormKey, f)

useModalFocusTrap(toRef(props, 'open'), {
  containerSelector: '.mm-modal',
  onClose: () => emit('close'),
  keepOpenOnFieldEscape: true,
})

const submitting = ref(false)
const errorMsg = ref('')

async function submit() {
  if (!f.canSubmit.value || submitting.value) return
  // Commit any tag / teammate the user typed but didn't press Enter on.
  f.addTag()
  f.addMember()
  submitting.value = true
  errorMsg.value = ''
  try {
    const rec = await CreateManualMatch(f.toInput())
    emit('created', rec)
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? e.body || e.message : String(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Transition name="mm-fade">
    <div v-if="open" class="mm-backdrop" @click.self="emit('close')">
      <aside
        class="mm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mm-title"
      >
        <header class="mm-head">
          <span class="mm-eyebrow">Add</span>
          <h4 id="mm-title" class="mm-title">
            Hand-enter a match
          </h4>
          <button class="mm-close" aria-label="Close (Esc)" title="Close (Esc)" @click="emit('close')">
            ×
          </button>
        </header>

        <ManualMatchForm :error-msg="errorMsg" />

        <footer class="mm-foot">
          <span class="mm-foot-status" :class="{ 'mm-foot-ready': f.canSubmit.value }">
            <template v-if="f.canSubmit.value">Ready to add</template>
            <template v-else>Still needed: {{ f.missingRequired.value.join(', ') }}</template>
          </span>
          <div class="mm-foot-actions">
            <button class="mm-btn ghost" @click="emit('close')">
              Cancel
            </button>
            <button class="mm-btn primary" data-mm-submit :disabled="!f.canSubmit.value || submitting" @click="submit">
              {{ submitting ? 'Adding…' : 'Add match' }}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
/* Centered popup over a dimmed page (the 012d42 background the user liked):
   a solid --surface card, not a slide-in panel. */
.mm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 4vh 1rem;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  backdrop-filter: blur(2px);
  overflow-y: auto;
}

.mm-modal {
  width: min(560px, 100%);
  max-height: 92vh;
  background: var(--surface);
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 4px;
  box-shadow: 0 18px 60px rgb(0 0 0 / 45%);
  padding: 0.9rem 1rem 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mm-fade-enter-active,
.mm-fade-leave-active { transition: opacity 180ms ease; }

.mm-fade-enter-from,
.mm-fade-leave-to { opacity: 0; }

.mm-fade-enter-active .mm-modal,
.mm-fade-leave-active .mm-modal { transition: transform 180ms ease; }

.mm-fade-enter-from .mm-modal,
.mm-fade-leave-to .mm-modal { transform: translateY(10px); }

@media (prefers-reduced-motion: reduce) {
  .mm-fade-enter-active,
  .mm-fade-leave-active,
  .mm-fade-enter-active .mm-modal,
  .mm-fade-leave-active .mm-modal { transition: none; }
}

.mm-head {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid var(--border);
}

.mm-eyebrow {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.mm-title {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  margin: 0;
}

.mm-close {
  appearance: none;
  margin-left: auto;
  background: transparent;
  border: 0;
  color: var(--text-faint);
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.3rem;
}

.mm-close:hover { color: var(--accent); }

.mm-foot {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: var(--surface);
  margin: 0 -1rem;
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--border);
}

.mm-foot-status {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.mm-foot-ready { color: var(--win); }

.mm-foot-actions { margin-left: auto; display: inline-flex; gap: 0.4rem; }

.mm-btn {
  appearance: none;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.4rem 0.9rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-dim);
  cursor: pointer;
}

.mm-btn.ghost:hover { border-color: var(--accent); color: var(--accent); }
.mm-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--primary-text-on-accent, var(--surface)); }
.mm-btn.primary:hover:not(:disabled) { background: var(--accent-bright, var(--accent)); }
.mm-btn.primary:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
