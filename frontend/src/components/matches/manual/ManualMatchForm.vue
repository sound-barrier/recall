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
const quick = computed(() => f.mode === 'leaver-exit')
const ow = useOWData()

const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Champion']
const DIVISIONS = [1, 2, 3, 4, 5]
// Disruption sides are multi-select toggles, not a single pick: a match can
// carry a leaver on both teams, and "a teammate left, then I left" is two.
const SIDES = [
  { value: 'self',  leaver: 'I left',     thrower: 'I threw' },
  { value: 'team',  leaver: 'Ally left',  thrower: 'Ally threw' },
  { value: 'enemy', leaver: 'Enemy left', thrower: 'Enemy threw' },
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
    <p v-if="quick" class="mm-lede">
      Overwatch drops matches you leave early. Record the map and how it ended.
    </p>
    <p v-else class="mm-legend">
      <span class="mm-req" aria-hidden="true">*</span> required
    </p>

    <!-- Map (required) — the narrow panel's searchable, lowercase picker. -->
    <section class="mm-section">
      <span class="eyebrow mm-eyebrow-label">Map <span v-if="!quick" class="mm-req" aria-hidden="true">*</span></span>
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
    <section v-if="!quick" class="mm-section">
      <span class="eyebrow mm-eyebrow-label">Mode <span class="mm-req" aria-hidden="true">*</span></span>
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
    <section v-if="!quick" class="mm-section">
      <span class="eyebrow mm-eyebrow-label">Queue <span class="mm-req" aria-hidden="true">*</span></span>
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
      <span class="eyebrow mm-eyebrow-label">Role <span class="mm-req" aria-hidden="true">*</span></span>
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
    <section v-if="!quick" class="mm-section">
      <span class="eyebrow mm-eyebrow-label">
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
      <span class="eyebrow mm-eyebrow-label">Result <span v-if="!quick" class="mm-req" aria-hidden="true">*</span></span>
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

    <!-- Leavers (optional, multi-select) -->
    <section v-if="!quick" class="mm-section">
      <span class="eyebrow mm-eyebrow-label">Leavers <span class="mm-optional">(optional)</span></span>
      <div class="mm-chips">
        <button
          v-for="opt in SIDES"
          :key="opt.value"
          class="mm-chip"
          :class="{ picked: f.leavers.value.includes(opt.value) }"
          :aria-pressed="f.leavers.value.includes(opt.value)"
          :data-leaver="opt.value"
          @click="f.toggleLeaver(opt.value)"
        >
          {{ opt.leaver }}
        </button>
      </div>
    </section>

    <!-- Throwers (optional, multi-select) -->
    <section v-if="!quick" class="mm-section">
      <span class="eyebrow mm-eyebrow-label">Throwers <span class="mm-optional">(optional)</span></span>
      <div class="mm-chips">
        <button
          v-for="opt in SIDES"
          :key="opt.value"
          class="mm-chip"
          :class="{ picked: f.throwers.value.includes(opt.value) }"
          :aria-pressed="f.throwers.value.includes(opt.value)"
          :data-thrower="opt.value"
          @click="f.toggleThrower(opt.value)"
        >
          {{ opt.thrower }}
        </button>
      </div>
    </section>

    <!-- Replay code (optional) -->
    <section v-if="!quick" class="mm-section">
      <label class="eyebrow mm-eyebrow-label" for="mm-replay">Replay code <span class="mm-optional">(optional)</span></label>
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
    <section v-if="!quick" class="mm-section">
      <label class="eyebrow mm-eyebrow-label" for="mm-note">Notes <span class="mm-optional">(optional)</span></label>
      <textarea
        id="mm-note"
        v-model="f.note.value"
        class="mm-input mm-textarea"
        rows="2"
        placeholder="What happened? Anything to review later?"
      />
    </section>

    <!-- Tags (optional) — type + Enter to add a chip. -->
    <section v-if="!quick" class="mm-section">
      <span class="eyebrow mm-eyebrow-label">Tags <span class="mm-optional">(optional)</span></span>
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
          aria-label="Add a tag"
          data-mm-tag-input
          @keydown.enter.prevent="f.addTag()"
        >
      </div>
    </section>

    <!-- Group / teammates (optional) -->
    <section v-if="!quick" class="mm-section">
      <span class="eyebrow mm-eyebrow-label">Group <span class="mm-optional">(teammates you queued with)</span></span>
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
          aria-label="Add a teammate"
          data-mm-member-input
          @keydown.enter.prevent="f.addMember()"
        >
      </div>
    </section>

    <!-- When (optional) -->
    <section v-if="!quick" class="mm-section">
      <label class="eyebrow mm-eyebrow-label" for="mm-when">When <span class="mm-optional">(defaults to now)</span></label>
      <input id="mm-when" v-model="f.playedAt.value" class="mm-input mm-input-short" type="datetime-local">
    </section>

    <!-- Rank (competitive only, optional) -->
    <section v-if="f.isCompetitive.value" class="mm-section">
      <span class="eyebrow mm-eyebrow-label">Rank <span class="mm-optional">(optional)</span></span>
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

<style scoped src="./manual-match-form.css"></style>
