<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { ApiError, CreateManualMatch, type MatchRecord } from '@/api'
import { useManualMatchForm } from '@/composables/matches/useManualMatchForm'
import { useOWData } from '@/composables/shared/useOWData'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'

// Hand-enter a match for users without OCR. A focus-trapped dialog whose
// fields map onto ManualMatchInput; submit POSTs via CreateManualMatch and
// lifts the created record so the parent reloads. A 409 (match already exists
// at that minute) surfaces inline without closing.
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; created: [record: MatchRecord] }>()

const f = useManualMatchForm()
const ow = useOWData()

useModalFocusTrap(toRef(props, 'open'), {
  containerSelector: '.mm-modal',
  onClose: () => emit('close'),
})

const mapOptions = computed(() => Object.values(ow.data.value?.maps_by_game_mode ?? {}).flat())
const heroOptions = computed(() => {
  const byRole = ow.data.value?.heroes_by_role ?? {}
  if (f.queueType.value === 'role' && f.roleCategory.value) {
    const key = Object.keys(byRole).find((k) => k.toLowerCase() === f.roleCategory.value)
    if (key) return byRole[key] ?? []
  }
  return Object.values(byRole).flat()
})

const submitting = ref(false)
const errorMsg = ref('')

function onHeroKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    f.addHero()
  }
}

async function submit() {
  if (!f.canSubmit.value || submitting.value) return
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
  <transition name="mm-fade">
    <div v-if="open" class="mm-backdrop" @click.self="emit('close')">
      <div
        class="mm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mm-title"
      >
        <header class="mm-head">
          <h2 id="mm-title" class="mm-title">
            Add a match
          </h2>
          <button type="button" class="mm-close" aria-label="Close (Esc)" title="Close (Esc)" @click="emit('close')">
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div class="mm-body">
          <!-- Map -->
          <div class="mm-field">
            <label class="mm-label" for="mm-map">Map</label>
            <input id="mm-map" v-model="f.map.value" class="mm-input" list="mm-maps" autocomplete="off" placeholder="e.g. Ilios">
            <datalist id="mm-maps">
              <option v-for="m in mapOptions" :key="m" :value="m" />
            </datalist>
          </div>

          <!-- Play mode -->
          <fieldset class="mm-field mm-fieldset">
            <legend class="mm-label">
              Mode
            </legend>
            <label class="mm-radio"><input v-model="f.playMode.value" type="radio" value="competitive">Competitive</label>
            <label class="mm-radio"><input v-model="f.playMode.value" type="radio" value="quickplay">Quick Play</label>
          </fieldset>

          <!-- Queue -->
          <fieldset class="mm-field mm-fieldset">
            <legend class="mm-label">
              Queue
            </legend>
            <label class="mm-radio"><input v-model="f.queueType.value" type="radio" value="role">Role Queue</label>
            <label class="mm-radio"><input v-model="f.queueType.value" type="radio" value="open">Open Queue</label>
          </fieldset>

          <!-- Role category (role queue only — narrows the hero picker) -->
          <fieldset v-if="f.isRoleQueue.value" class="mm-field mm-fieldset">
            <legend class="mm-label">
              Role <span class="mm-optional">(optional)</span>
            </legend>
            <label class="mm-radio"><input v-model="f.roleCategory.value" type="radio" value="tank">Tank</label>
            <label class="mm-radio"><input v-model="f.roleCategory.value" type="radio" value="damage">Damage</label>
            <label class="mm-radio"><input v-model="f.roleCategory.value" type="radio" value="support">Support</label>
          </fieldset>

          <!-- Heroes -->
          <div class="mm-field">
            <label class="mm-label" for="mm-hero">Heroes played <span class="mm-hint">(first = primary)</span></label>
            <div class="mm-hero-add">
              <input id="mm-hero" v-model="f.heroDraft.value" class="mm-input" list="mm-heroes" autocomplete="off" placeholder="Type a hero, press Enter" @keydown="onHeroKeydown">
              <button type="button" class="mm-add-btn" :disabled="!f.heroDraft.value.trim()" @click="f.addHero()">
                Add
              </button>
            </div>
            <datalist id="mm-heroes">
              <option v-for="h in heroOptions" :key="h" :value="h" />
            </datalist>
            <ul v-if="f.heroes.value.length" class="mm-chips">
              <li v-for="(h, i) in f.heroes.value" :key="h" class="mm-chip" :class="{ 'mm-chip-primary': i === 0 }">
                <span v-if="i === 0" class="mm-chip-tag">primary</span>
                {{ h }}
                <button type="button" class="mm-chip-x" :aria-label="`Remove ${h}`" @click="f.removeHero(h)">
                  ×
                </button>
              </li>
            </ul>
          </div>

          <!-- Result -->
          <fieldset class="mm-field mm-fieldset">
            <legend class="mm-label">
              Result
            </legend>
            <label class="mm-radio"><input v-model="f.result.value" type="radio" value="victory">Victory</label>
            <label class="mm-radio"><input v-model="f.result.value" type="radio" value="defeat">Defeat</label>
            <label class="mm-radio"><input v-model="f.result.value" type="radio" value="draw">Draw</label>
          </fieldset>

          <!-- When -->
          <div class="mm-field">
            <label class="mm-label" for="mm-when">When <span class="mm-hint">(defaults to now)</span></label>
            <input id="mm-when" v-model="f.playedAt.value" class="mm-input" type="datetime-local">
          </div>

          <!-- Rank (competitive only) -->
          <fieldset v-if="f.isCompetitive.value" class="mm-field mm-fieldset mm-rank">
            <legend class="mm-label">
              Rank <span class="mm-optional">(optional)</span>
            </legend>
            <div class="mm-rank-grid">
              <label class="mm-sublabel">Tier
                <input v-model="f.rankTier.value" class="mm-input" list="mm-tiers" autocomplete="off" placeholder="Platinum">
              </label>
              <label class="mm-sublabel">Division
                <input v-model.number="f.rankDivision.value" class="mm-input" type="number" min="1" max="5">
              </label>
              <label class="mm-sublabel">Progress %
                <input v-model.number="f.rankProgress.value" class="mm-input" type="number" min="0" max="100">
              </label>
              <label class="mm-sublabel">RR change %
                <input v-model.number="f.rankChange.value" class="mm-input" type="number">
              </label>
            </div>
            <datalist id="mm-tiers">
              <option v-for="t in ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Champion']" :key="t" :value="t" />
            </datalist>
            <label class="mm-check"><input v-model="f.demotionProtection.value" type="checkbox">Demotion protection</label>
          </fieldset>

          <p v-if="errorMsg" class="mm-error" role="alert">
            {{ errorMsg }}
          </p>
        </div>

        <footer class="mm-foot">
          <button type="button" class="mm-btn mm-btn-ghost" @click="emit('close')">
            Cancel
          </button>
          <button type="button" class="mm-btn mm-btn-primary" :disabled="!f.canSubmit.value || submitting" @click="submit">
            {{ submitting ? 'Adding…' : 'Add match' }}
          </button>
        </footer>
      </div>
    </div>
  </transition>
</template>

<style scoped>
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
  background: var(--surface);
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 4px;
  box-shadow: 0 18px 60px rgb(0 0 0 / 45%);
  display: flex;
  flex-direction: column;
  max-height: 92vh;
}

.mm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.2rem 0.7rem;
  border-bottom: 1px solid var(--border);
}

.mm-title {
  margin: 0;
  font-family: var(--display);
  font-style: italic;
  font-size: 1.4rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--text);
}

.mm-close {
  appearance: none;
  background: none;
  border: 0;
  font-size: 1.4rem;
  line-height: 1;
  color: var(--text-faint);
  cursor: pointer;
  padding: 0.2rem 0.4rem;
}

.mm-close:hover { color: var(--text); }

.mm-body {
  padding: 1rem 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: auto;
}

.mm-field { display: flex; flex-direction: column; gap: 0.4rem; }

.mm-fieldset {
  border: 0;
  margin: 0;
  padding: 0;
  flex-flow: row wrap;
  gap: 0.5rem 1rem;
  align-items: center;
}

.mm-label {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
}

.mm-optional, .mm-hint { color: var(--text-faint); font-weight: 400; letter-spacing: 0.04em; }

.mm-input {
  font-family: var(--mono);
  font-size: 0.9rem;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.45rem 0.55rem;
}

.mm-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.mm-radio, .mm-check {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  color: var(--text);
  cursor: pointer;
}

.mm-hero-add { display: flex; gap: 0.5rem; }
.mm-hero-add .mm-input { flex: 1; }

.mm-add-btn {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
  padding: 0 0.7rem;
  border: 1px solid var(--accent-soft);
  border-radius: 2px;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
}

.mm-add-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.mm-chips { list-style: none; margin: 0.2rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.35rem; }

.mm-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: var(--mono);
  font-size: 0.78rem;
  padding: 0.18rem 0.2rem 0.18rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
  text-transform: lowercase;
}

.mm-chip-primary { border-color: var(--accent-soft); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }

.mm-chip-tag {
  font-size: 0.5rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.mm-chip-x {
  appearance: none;
  background: none;
  border: 0;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0 0.25rem;
}

.mm-chip-x:hover { color: var(--loss); }

.mm-rank-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; width: 100%; }
.mm-sublabel { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.72rem; color: var(--text-dim); }

.mm-error {
  margin: 0;
  font-size: 0.82rem;
  color: var(--loss);
  border: 1px solid var(--loss);
  background: color-mix(in srgb, var(--loss) 10%, transparent);
  border-radius: 2px;
  padding: 0.5rem 0.65rem;
}

.mm-foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 0.8rem 1.2rem;
  border-top: 1px solid var(--border);
}

.mm-btn {
  font-family: var(--mono);
  font-size: 0.66rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  padding: 0.55rem 1.1rem;
  border-radius: 2px;
  cursor: pointer;
  border: 1px solid var(--border);
}

.mm-btn-ghost { background: transparent; color: var(--text-dim); }
.mm-btn-ghost:hover { color: var(--text); border-color: var(--border-strong, var(--text-faint)); }

.mm-btn-primary { background: var(--accent); color: var(--primary-text-on-accent, var(--bg)); border-color: var(--accent); }
.mm-btn-primary:hover:not(:disabled) { background: var(--accent-bright, var(--accent)); }
.mm-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }

.mm-fade-enter-active, .mm-fade-leave-active { transition: opacity 160ms ease; }
.mm-fade-enter-from, .mm-fade-leave-to { opacity: 0; }
</style>
