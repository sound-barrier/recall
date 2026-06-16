<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
import { ApiError, CreateManualMatch, type MatchRecord } from '@/api'
import { useManualMatchForm } from '@/composables/matches/useManualMatchForm'
import { useOWData } from '@/composables/shared/useOWData'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'
import FilterCombobox from '@/components/shared/FilterCombobox.vue'

// Hand-enter a match for users without OCR. A centered popup modal (solid
// surface over a dimmed page) dressed in the Filter-matches panel's visual
// language: the map + hero pickers are the same FilterCombobox the narrow
// panel uses (lowercase, searchable), mode / queue / role / result / leaver
// are chip toggles, and required fields carry a red asterisk. Submit POSTs via
// CreateManualMatch; a 409 surfaces inline without closing.
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; created: [record: MatchRecord] }>()

const f = useManualMatchForm()
const ow = useOWData()

useModalFocusTrap(toRef(props, 'open'), {
  containerSelector: '.mm-modal',
  onClose: () => emit('close'),
  keepOpenOnFieldEscape: true,
})

const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Champion']
const DIVISIONS = [1, 2, 3, 4, 5]
const LEAVERS = [
  { value: '', label: 'None' },
  { value: 'self', label: 'I left' },
  { value: 'team', label: 'Ally left' },
  { value: 'enemy', label: 'Enemy left' },
] as const

// Only one combobox dropdown open at a time (mirrors the narrow panel).
const comboOpen = ref<'map' | 'hero' | null>(null)

// Normalized (lowercase) roster values — the same stored form OCR matches use,
// so a hand-entered match groups + displays identically. Heroes narrow to the
// picked role on role queue.
const mapOptions = computed(() => [...ow.mapIndex.value.keys()].sort((a, b) => a.localeCompare(b)))
const heroOptions = computed(() => {
  const entries = [...ow.heroIndex.value.entries()]
  // Role queue is single-role: a match is played entirely as tank, damage, OR
  // support — never a mix. Force the role pick first (empty list until then),
  // then offer only that role's heroes. Open queue lets you swap freely, so
  // every hero is offered.
  if (f.queueType.value === 'role') {
    if (!f.roleCategory.value) return []
    return entries
      .filter(([, v]) => v.role.toLowerCase() === f.roleCategory.value)
      .map(([k]) => k)
      .sort((a, b) => a.localeCompare(b))
  }
  return entries.map(([k]) => k).sort((a, b) => a.localeCompare(b))
})

// The hero picker's copy nudges the user to choose a role first on role queue.
const heroPlaceholder = computed(() =>
  f.queueType.value === 'role' && !f.roleCategory.value ? 'pick a role first' : 'type to search heroes…',
)
const heroEmptyMessage = computed(() =>
  f.queueType.value === 'role' && !f.roleCategory.value ? 'pick a role above first' : 'no heroes match',
)

// Keep the hero selection legal as the rules change: when the queue type or
// role category changes, drop any picked hero that's no longer allowed
// (switching open→role clears until a role is chosen; tank→support drops the
// tank picks). Heroes aren't watched, so this can't loop.
watch([() => f.queueType.value, () => f.roleCategory.value], () => {
  const allowed = new Set(heroOptions.value)
  f.heroes.value = f.heroes.value.filter((h) => allowed.has(h))
})

const mapPicked = computed(() => (f.map.value ? new Set([f.map.value]) : new Set<string>()))
const heroPicked = computed(() => new Set(f.heroes.value))

function onToggleMap(v: string) {
  // Single-select: one map per match. Pick replaces; re-picking clears. Close
  // the dropdown on pick so it reads as a single choice (the hero picker is
  // multi and stays open).
  f.map.value = f.map.value === v ? '' : v
  comboOpen.value = null
}
function onToggleHero(v: string) {
  if (f.heroes.value.includes(v)) f.removeHero(v)
  else f.addHero(v)
}

// Click outside the open dropdown closes it (the narrow panel's contract).
function onDocMousedown(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  if (comboOpen.value && t && !t.closest(`[data-combo-id="mm-${comboOpen.value}"]`)) {
    comboOpen.value = null
  }
}
onMounted(() => document.addEventListener('mousedown', onDocMousedown))
onUnmounted(() => document.removeEventListener('mousedown', onDocMousedown))

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

        <div class="mm-body">
          <p class="mm-legend">
            <span class="mm-req" aria-hidden="true">*</span> required
          </p>

          <!-- Map (required) — the narrow panel's searchable, lowercase picker. -->
          <section class="mm-section">
            <span class="mm-eyebrow-label">Map <span class="mm-req" aria-hidden="true">*</span></span>
            <FilterCombobox
              combo-id="mm-map"
              label="Map"
              :options="mapOptions"
              :picked="mapPicked"
              :open="comboOpen === 'map'"
              placeholder="type to search maps…"
              empty-message="no maps match"
              @toggle="onToggleMap"
              @open="comboOpen = 'map'"
              @close="comboOpen = null"
            />
          </section>

          <!-- Mode (required) -->
          <section class="mm-section">
            <span class="mm-eyebrow-label">Mode <span class="mm-req" aria-hidden="true">*</span></span>
            <div class="mm-chips">
              <button class="mm-chip" :class="{ picked: f.playMode.value === 'competitive' }" data-mode="competitive" @click="f.playMode.value = 'competitive'">
                Competitive
              </button>
              <button class="mm-chip" :class="{ picked: f.playMode.value === 'quickplay' }" data-mode="quickplay" @click="f.playMode.value = 'quickplay'">
                Quick Play
              </button>
            </div>
          </section>

          <!-- Queue (required) -->
          <section class="mm-section">
            <span class="mm-eyebrow-label">Queue <span class="mm-req" aria-hidden="true">*</span></span>
            <div class="mm-chips">
              <button class="mm-chip" :class="{ picked: f.queueType.value === 'role' }" data-queue="role" @click="f.queueType.value = 'role'">
                Role Queue
              </button>
              <button class="mm-chip" :class="{ picked: f.queueType.value === 'open' }" data-queue="open" @click="f.queueType.value = 'open'">
                Open Queue
              </button>
            </div>
          </section>

          <!-- Role category (required on role queue — a single-role queue, so
               it constrains the hero list to that one role) -->
          <section v-if="f.isRoleQueue.value" class="mm-section">
            <span class="mm-eyebrow-label">Role <span class="mm-req" aria-hidden="true">*</span></span>
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

          <!-- Heroes (required) — same picker as Map; first selected is primary. -->
          <section class="mm-section">
            <span class="mm-eyebrow-label">
              Heroes played <span class="mm-req" aria-hidden="true">*</span>
              <span class="mm-optional">first = primary</span>
            </span>
            <FilterCombobox
              combo-id="mm-hero"
              label="Heroes"
              :options="heroOptions"
              :picked="heroPicked"
              :open="comboOpen === 'hero'"
              :first-is-primary="true"
              :placeholder="heroPlaceholder"
              :empty-message="heroEmptyMessage"
              @toggle="onToggleHero"
              @open="comboOpen = 'hero'"
              @close="comboOpen = null"
            />
          </section>

          <!-- Result (required) -->
          <section class="mm-section">
            <span class="mm-eyebrow-label">Result <span class="mm-req" aria-hidden="true">*</span></span>
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

          <!-- Leaver (optional) -->
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

          <!-- Replay code (optional) -->
          <section class="mm-section">
            <label class="mm-eyebrow-label" for="mm-replay">Replay code <span class="mm-optional">(optional)</span></label>
            <input
              id="mm-replay"
              v-model="f.replayCode.value"
              class="mm-input mm-input-short"
              type="text"
              maxlength="12"
              autocapitalize="characters"
              autocomplete="off"
              spellcheck="false"
              placeholder="e.g. A1B2C3"
            >
          </section>

          <!-- Notes (optional) -->
          <section class="mm-section">
            <label class="mm-eyebrow-label" for="mm-note">Notes <span class="mm-optional">(optional)</span></label>
            <textarea
              id="mm-note"
              v-model="f.note.value"
              class="mm-input mm-textarea"
              rows="2"
              placeholder="What happened? Anything to review later?"
            />
          </section>

          <!-- Tags (optional) — type + Enter to add a chip. -->
          <section class="mm-section">
            <span class="mm-eyebrow-label">Tags <span class="mm-optional">(optional)</span></span>
            <div class="mm-tokens">
              <button
                v-for="t in f.tags.value"
                :key="t"
                type="button"
                class="mm-token"
                :aria-label="`Remove tag ${t}`"
                data-mm-tag
                @click="f.removeTag(t)"
              >
                #{{ t }}<span class="mm-token-x" aria-hidden="true">×</span>
              </button>
              <input
                v-model="f.tagDraft.value"
                class="mm-token-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="add a tag…"
                data-mm-tag-input
                @keydown.enter.prevent="f.addTag()"
              >
            </div>
          </section>

          <!-- Group / teammates (optional) -->
          <section class="mm-section">
            <span class="mm-eyebrow-label">Group <span class="mm-optional">(teammates you queued with)</span></span>
            <div class="mm-tokens">
              <button
                v-for="m in f.members.value"
                :key="m"
                type="button"
                class="mm-token"
                :aria-label="`Remove teammate ${m}`"
                data-mm-member
                @click="f.removeMember(m)"
              >
                {{ m }}<span class="mm-token-x" aria-hidden="true">×</span>
              </button>
              <input
                v-model="f.memberDraft.value"
                class="mm-token-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="add a teammate…"
                data-mm-member-input
                @keydown.enter.prevent="f.addMember()"
              >
            </div>
          </section>

          <!-- When (optional) -->
          <section class="mm-section">
            <label class="mm-eyebrow-label" for="mm-when">When <span class="mm-optional">(defaults to now)</span></label>
            <input id="mm-when" v-model="f.playedAt.value" class="mm-input mm-input-short" type="datetime-local">
          </section>

          <!-- Rank (competitive only, optional) -->
          <section v-if="f.isCompetitive.value" class="mm-section">
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

.mm-body {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.6rem 0;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.mm-legend {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.04em;
  color: var(--text-faint);
}

.mm-req {
  color: var(--loss);
  font-weight: 700;
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

.mm-textarea {
  width: 100%;
  resize: vertical;
  min-height: 2.4rem;
  line-height: 1.4;
}

/* Tag / teammate chip-input: type + Enter adds a token; click a token to
   drop it (it reddens on hover to signal removal). */
.mm-tokens {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
}

.mm-tokens:focus-within { border-color: var(--accent); }

.mm-token {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1px solid var(--accent);
  border-radius: 2px;
  padding: 0.12rem 0.4rem;
  font-family: var(--mono);
  font-size: 0.64rem;
  color: var(--accent);
  cursor: pointer;
  letter-spacing: 0.02em;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.mm-token:hover {
  background: color-mix(in srgb, var(--loss) 16%, transparent);
  border-color: var(--loss);
  color: var(--loss);
}

.mm-token:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.mm-token-x { font-weight: 700; }

.mm-token-input {
  appearance: none;
  flex: 1;
  min-width: 7rem;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.78rem;
  padding: 0.1rem 0.2rem;
}

.mm-token-input::placeholder { color: var(--text-faint); }

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
