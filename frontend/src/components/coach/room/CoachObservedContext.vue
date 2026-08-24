<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { MatchRecord, ObservedContext } from '@/api-client'
import { useOWData } from '@/composables/shared/useOWData'

// What the coach saw, for a match the app has never seen.
//
// A replay frame starts blank: there is no screenshot and nothing parsed
// from one, so the card would otherwise read "No result · Not dated · —".
// This is where the coach writes down the map, the hero and the outcome, so
// the notes they hand back read like a match card rather than a list of
// codes — and so the player's side has something to create the match from
// when they do not have it.
//
// Every field is optional. A coach who noticed the map and nothing else says
// only that; inventing the rest would be fabricating data, which is the same
// rule the manual-match form states as "only omission is free".
//
// The DATE defaults to the session date rather than being left blank, and
// that default is load-bearing rather than a convenience. A match with no
// time at all passes every date filter there is — it would turn up in every
// season and every "last 30 days" on the player's side, because a record
// with no placeable time is deliberately never excluded by a range. One
// pre-filled field the coach can correct is a far better trade than a match
// that is everywhere.

const props = defineProps<{
  record: MatchRecord
  /** Today, as the session reckons it — the date a blank field falls back to. */
  sessionDate: string
}>()

const emit = defineEmits<{ update: [context: ObservedContext] }>()

const { heroIndex, mapIndex } = useOWData()
// The datalists offer the canonical display names, so a coach who picks from
// the list types something the player's import will certainly accept.
const maps = computed(() => [...mapIndex.value.values()].map((m) => m.display).sort())
const heroes = computed(() => [...heroIndex.value.values()].map((h) => h.display).sort())

// The draft carries '' where the wire carries "absent". They are the same
// thing — "only omission is free" — but a <select> needs a value for its
// "Not sure" option, and the wire type has no empty member because an empty
// result is not a result. commit() is where the two meet.
//
// commit() rides change and blur, never keystrokes: an @input commit fed
// the autosave debounce mid-word, and a coach pausing halfway through
// "Ilios" shipped "Ilio" to the server.
type ContextDraft = Omit<ObservedContext, 'result'> & { result: '' | NonNullable<ObservedContext['result']> }

const draft = ref<ContextDraft>({ result: '' })

watch(() => props.record.match_key, () => {
  const d = props.record.data ?? {}
  draft.value = {
    map: d.map ?? '',
    hero: d.hero ?? '',
    result: d.result ?? '',
    date: d.date ?? props.sessionDate,
    finished_at: d.finished_at ?? '',
  }
}, { immediate: true })

const replayCode = computed(() => props.record.annotation?.replay_code ?? '')

function commit(): void {
  const { result, ...rest } = draft.value
  emit('update', result === '' ? rest : { ...rest, result })
}
</script>

<template>
  <section class="observed" :aria-label="`What you saw in ${replayCode}`">
    <p class="eyebrow observed-eyebrow">
      What you saw
    </p>
    <div class="observed-grid">
      <div class="observed-field">
        <label class="eyebrow" :for="`observed-map-${record.match_key}`">Map</label>
        <input
          :id="`observed-map-${record.match_key}`"
          v-model="draft.map"
          class="mm-input"
          list="observed-maps"
          autocomplete="off"
          placeholder="e.g. Ilios"
          @change="commit"
          @blur="commit"
        >
        <datalist id="observed-maps">
          <option v-for="m in maps" :key="m" :value="m" />
        </datalist>
      </div>

      <div class="observed-field">
        <label class="eyebrow" :for="`observed-hero-${record.match_key}`">Hero</label>
        <input
          :id="`observed-hero-${record.match_key}`"
          v-model="draft.hero"
          class="mm-input"
          list="observed-heroes"
          autocomplete="off"
          placeholder="e.g. Ana"
          @change="commit"
          @blur="commit"
        >
        <datalist id="observed-heroes">
          <option v-for="h in heroes" :key="h" :value="h" />
        </datalist>
      </div>

      <div class="observed-field">
        <label class="eyebrow" :for="`observed-result-${record.match_key}`">Result</label>
        <select
          :id="`observed-result-${record.match_key}`"
          v-model="draft.result"
          class="mm-input"
          @change="commit"
        >
          <option value="">
            Not sure
          </option>
          <option value="victory">
            Victory
          </option>
          <option value="defeat">
            Defeat
          </option>
          <option value="draw">
            Draw
          </option>
        </select>
      </div>

      <div class="observed-field">
        <label class="eyebrow" :for="`observed-date-${record.match_key}`">Date</label>
        <input
          :id="`observed-date-${record.match_key}`"
          v-model="draft.date"
          class="mm-input"
          type="date"
          @change="commit"
          @blur="commit"
        >
      </div>
    </div>
  </section>
</template>

<style scoped>
.observed {
  padding: var(--space-3);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}

.observed-eyebrow {
  margin: 0 0 var(--space-2);
}

.observed-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: var(--space-2);
}

.observed-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
</style>
