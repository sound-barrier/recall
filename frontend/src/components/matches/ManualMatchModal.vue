<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { ApiError, CreateManualMatch, type MatchRecord } from '@/api'
import { useManualMatchForm } from '@/composables/matches/useManualMatchForm'
import { useOWData } from '@/composables/shared/useOWData'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'

// Hand-enter a match for users without OCR. A centered modal dressed in the
// "Filter matches" panel's visual language — eyebrow sections, chip toggles,
// consistent inputs / dropdowns. Submit POSTs via CreateManualMatch and lifts
// the created record so the parent reloads; a 409 (a match already exists at
// that minute) surfaces inline without closing.
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; created: [record: MatchRecord] }>()

const f = useManualMatchForm()
const ow = useOWData()

useModalFocusTrap(toRef(props, 'open'), {
  containerSelector: '.mm-modal',
  onClose: () => emit('close'),
})

const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Champion']
const DIVISIONS = [1, 2, 3, 4, 5]
const LEAVERS = [
  { value: '', label: 'None' },
  { value: 'self', label: 'I left' },
  { value: 'team', label: 'Ally left' },
  { value: 'enemy', label: 'Enemy left' },
] as const

const mapOptions = computed(() =>
  Object.values(ow.data.value?.maps_by_game_mode ?? {}).flat().sort((a, b) => a.localeCompare(b)),
)
const heroOptions = computed(() => {
  const byRole = ow.data.value?.heroes_by_role ?? {}
  let names: string[]
  if (f.queueType.value === 'role' && f.roleCategory.value) {
    const key = Object.keys(byRole).find((k) => k.toLowerCase() === f.roleCategory.value)
    names = key ? (byRole[key] ?? []) : Object.values(byRole).flat()
  } else {
    names = Object.values(byRole).flat()
  }
  return [...names].sort((a, b) => a.localeCompare(b))
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

        <div class="mm-body">
          <!-- Map -->
          <section class="mm-section">
            <label class="mm-eyebrow-label" for="mm-map">Map</label>
            <input
              id="mm-map"
              v-model="f.map.value"
              class="mm-input"
              list="mm-maps"
              autocomplete="off"
              placeholder="type to search maps…"
            >
            <datalist id="mm-maps">
              <option v-for="m in mapOptions" :key="m" :value="m" />
            </datalist>
          </section>

          <!-- Mode -->
          <section class="mm-section">
            <span class="mm-eyebrow-label">Mode</span>
            <div class="mm-chips">
              <button class="mm-chip" :class="{ picked: f.playMode.value === 'competitive' }" data-mode="competitive" @click="f.playMode.value = 'competitive'">
                Competitive
              </button>
              <button class="mm-chip" :class="{ picked: f.playMode.value === 'quickplay' }" data-mode="quickplay" @click="f.playMode.value = 'quickplay'">
                Quick Play
              </button>
            </div>
          </section>

          <!-- Queue -->
          <section class="mm-section">
            <span class="mm-eyebrow-label">Queue</span>
            <div class="mm-chips">
              <button class="mm-chip" :class="{ picked: f.queueType.value === 'role' }" data-queue="role" @click="f.queueType.value = 'role'">
                Role Queue
              </button>
              <button class="mm-chip" :class="{ picked: f.queueType.value === 'open' }" data-queue="open" @click="f.queueType.value = 'open'">
                Open Queue
              </button>
            </div>
          </section>

          <!-- Role category (role queue only — narrows the hero picker) -->
          <section v-if="f.isRoleQueue.value" class="mm-section">
            <span class="mm-eyebrow-label">Role <span class="mm-optional">(optional)</span></span>
            <div class="mm-chips">
              <button
                v-for="r in (['tank', 'damage', 'support'] as const)"
                :key="r"
                class="mm-chip"
                :class="{ picked: f.roleCategory.value === r }"
                :data-role="r"
                @click="f.roleCategory.value = (f.roleCategory.value === r ? '' : r)"
              >
                {{ r }}
              </button>
            </div>
          </section>

          <!-- Heroes -->
          <section class="mm-section">
            <label class="mm-eyebrow-label" for="mm-hero">Heroes played <span class="mm-optional">(first = primary)</span></label>
            <div class="mm-hero-add">
              <input
                id="mm-hero"
                v-model="f.heroDraft.value"
                class="mm-input"
                list="mm-heroes"
                autocomplete="off"
                placeholder="type a hero, press Enter"
                @keydown="onHeroKeydown"
              >
              <button class="mm-add-btn" :disabled="!f.heroDraft.value.trim()" @click="f.addHero()">
                Add
              </button>
            </div>
            <datalist id="mm-heroes">
              <option v-for="h in heroOptions" :key="h" :value="h" />
            </datalist>
            <ul v-if="f.heroes.value.length" class="mm-hero-list">
              <li v-for="(h, i) in f.heroes.value" :key="h" class="mm-hero-chip" :class="{ 'mm-hero-primary': i === 0 }">
                <span v-if="i === 0" class="mm-hero-tag">primary</span>
                {{ h }}
                <button class="mm-hero-x" :aria-label="`Remove ${h}`" @click="f.removeHero(h)">
                  ×
                </button>
              </li>
            </ul>
          </section>

          <!-- Result -->
          <section class="mm-section">
            <span class="mm-eyebrow-label">Result</span>
            <div class="mm-chips">
              <button
                v-for="r in (['victory', 'defeat', 'draw'] as const)"
                :key="r"
                class="mm-chip"
                :class="{ picked: f.result.value === r }"
                :data-result="r"
                @click="f.result.value = r"
              >
                {{ r }}
              </button>
            </div>
          </section>

          <!-- Leaver -->
          <section class="mm-section">
            <span class="mm-eyebrow-label">Leaver <span class="mm-optional">(optional)</span></span>
            <div class="mm-chips">
              <button
                v-for="opt in LEAVERS"
                :key="opt.value || 'none'"
                class="mm-chip"
                :class="{ picked: f.leaver.value === opt.value }"
                :data-leaver="opt.value || 'none'"
                @click="f.leaver.value = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </section>

          <!-- When -->
          <section class="mm-section">
            <label class="mm-eyebrow-label" for="mm-when">When <span class="mm-optional">(defaults to now)</span></label>
            <input id="mm-when" v-model="f.playedAt.value" class="mm-input mm-input-short" type="datetime-local">
          </section>

          <!-- Rank (competitive only) -->
          <section v-if="f.isCompetitive.value" class="mm-section mm-rank">
            <span class="mm-eyebrow-label">Rank <span class="mm-optional">(optional)</span></span>
            <div class="mm-rank-grid">
              <label class="mm-sublabel">Tier
                <select v-model="f.rankTier.value" class="mm-input">
                  <option value="">
                    —
                  </option>
                  <option v-for="t in TIERS" :key="t" :value="t">
                    {{ t }}
                  </option>
                </select>
              </label>
              <label class="mm-sublabel">Division
                <select v-model.number="f.rankDivision.value" class="mm-input">
                  <option v-for="d in DIVISIONS" :key="d" :value="d">
                    {{ d }}
                  </option>
                </select>
              </label>
              <label class="mm-sublabel">Progress %
                <input v-model.number="f.rankProgress.value" class="mm-input" type="number" min="0" max="100">
              </label>
              <label class="mm-sublabel">RR change %
                <input v-model.number="f.rankChange.value" class="mm-input" type="number">
              </label>
            </div>
            <label class="mm-check"><input v-model="f.demotionProtection.value" type="checkbox">Demotion protection</label>
          </section>

          <p v-if="errorMsg" class="mm-error" role="alert">
            {{ errorMsg }}
          </p>
        </div>

        <footer class="mm-foot">
          <span class="mm-foot-status">{{ f.canSubmit.value ? 'ready' : 'map · mode · queue · result · 1 hero' }}</span>
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
/* Mirrors the Filter-matches panel (NarrowPopover): left slide-in side panel,
   eyebrow sections, chip toggles, sticky footer. Self-contained scoped styles
   rather than sharing NarrowPopover's (decoupled components). */
.mm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  backdrop-filter: blur(2px);
}

.mm-panel {
  position: fixed;
  left: 0; top: 0;
  z-index: 100;
  width: min(420px, 100vw);
  height: 100vh;
  background: var(--surface);
  border-right: 1px solid var(--accent);
  box-shadow: 28px 0 60px -24px rgb(0 0 0 / 65%);
  padding: 0.9rem 1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  overflow-y: auto;
}

.mm-panel::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--accent);
}

.mm-slide-enter-active,
.mm-slide-leave-active { transition: transform 240ms ease, opacity 240ms ease; }
.mm-slide-enter-from   { transform: translateX(-100%); opacity: 0; }
.mm-slide-leave-to     { transform: translateX(-100%); opacity: 0; }

.mm-fade-enter-active,
.mm-fade-leave-active { transition: opacity 200ms ease; }

.mm-fade-enter-from,
.mm-fade-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .mm-slide-enter-active,
  .mm-slide-leave-active,
  .mm-fade-enter-active,
  .mm-fade-leave-active { transition: none; }
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

.mm-body {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding-bottom: 0.5rem;
}

.mm-section {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.mm-eyebrow-label {
  font-family: var(--mono);
  font-size: 0.56rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
}

.mm-optional { color: var(--text-faint); font-weight: 400; letter-spacing: 0.04em; }

.mm-input {
  appearance: none;
  font-family: var(--mono);
  font-size: 0.82rem;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.4rem 0.5rem;
  color-scheme: dark light;
}

.mm-input:focus-visible { outline: 0; border-color: var(--accent); }
.mm-input-short { width: max-content; }

.mm-chips { display: flex; flex-wrap: wrap; gap: 0.25rem; }

.mm-chip {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.28rem 0.6rem;
  font-family: var(--mono);
  font-size: 0.64rem;
  color: var(--text-dim);
  cursor: pointer;
  letter-spacing: 0.04em;
  text-transform: capitalize;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.mm-chip:hover { border-color: var(--accent-soft, var(--accent)); color: var(--text); }

.mm-chip.picked {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 700;
}

.mm-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.mm-hero-add { display: flex; gap: 0.4rem; }
.mm-hero-add .mm-input { flex: 1; }

.mm-add-btn {
  appearance: none;
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

.mm-hero-list { list-style: none; margin: 0.15rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.3rem; }

.mm-hero-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: var(--mono);
  font-size: 0.74rem;
  padding: 0.16rem 0.2rem 0.16rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
  text-transform: lowercase;
}

.mm-hero-primary { border-color: var(--accent-soft); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }

.mm-hero-tag {
  font-size: 0.48rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.mm-hero-x {
  appearance: none;
  background: none;
  border: 0;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 0.95rem;
  line-height: 1;
  padding: 0 0.2rem;
}

.mm-hero-x:hover { color: var(--loss); }

.mm-rank-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }

.mm-sublabel {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.mm-check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text);
  cursor: pointer;
}

.mm-check input { accent-color: var(--accent); }

.mm-error {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.74rem;
  color: var(--loss);
  border: 1px solid var(--loss);
  background: color-mix(in srgb, var(--loss) 10%, transparent);
  border-radius: 2px;
  padding: 0.5rem 0.6rem;
}

.mm-foot {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  position: sticky;
  bottom: 0;
  background: var(--surface);
  margin: 0 -1rem;
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--border);
}

.mm-foot-status {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

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
