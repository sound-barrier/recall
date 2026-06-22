<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'

import { useOWData } from '@/composables/shared/useOWData'
import { manualMatchFormKey } from '@/composables/matches/useManualMatchForm'
import FilterCombobox from '@/components/shared/FilterCombobox.vue'

// The hand-enter match form body — the map/hero FilterCombobox pickers, the chip
// toggles (mode / queue / role / result / leaver), and the optional fields
// (replay, notes, tags, group, when, rank). Extracted from ManualMatchModal so the
// modal keeps only the shell (backdrop, header, footer, focus trap, submit); this
// owns the form markup + the combobox wiring (option lists, outside-click close,
// hero/role legality), reading + writing the shared form bundle passed down. The
// submit error is shown here too (passed as a prop) so it sits at the form's tail.
defineProps<{
  errorMsg: string
}>()
// The single form instance is provided by the parent ManualMatchModal; injecting
// (rather than taking it as a prop) lets this child mutate the reactive bundle.
const f = inject(manualMatchFormKey)!
const ow = useOWData()

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
</script>

<template>
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
          <input v-model.number="f.rankChange.value" class="mm-input" type="number" min="-1000000" max="1000000">
        </label>
      </div>
      <label class="mm-check"><input v-model="f.demotionProtection.value" type="checkbox">Demotion protection</label>
      <p v-if="f.rankError.value" class="mm-rank-error" role="alert">
        {{ f.rankError.value }}
      </p>
    </section>

    <p v-if="errorMsg" class="mm-error" role="alert">
      {{ errorMsg }}
    </p>
  </div>
</template>

<style scoped>
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

.mm-rank-error {
  margin: 0.4rem 0 0;
  font-size: 0.75rem;
  color: var(--loss);
}

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
</style>
