<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef } from 'vue'

import type { FieldFlag, MatchRecord } from '@/api-client'
import SourceCrop from '@/components/shared/SourceCrop.vue'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { flagEditKind, otherReadings, RESULTS, withFlaggedValue } from '@/match/quality/flag-edits'
import { CHECK_LABEL, fieldLabel, readingSource } from '@/match/quality/flag-labels'
import { useFieldRegionsQuery } from '@/queries/fieldRegions'

// One flagged reading beside the pixels it was read from. The card asks and
// the section writes, so the three ways to settle it are events: confirm the
// value shown, write another value (typed, or the reading another source
// made), or re-open a confirmation. Which of them fit depends on the field —
// who was played has no edit here (see match/quality/flag-edits).
const props = defineProps<{
  /** The record as read, never the stats' copy: the review shows what it asks about. */
  rec: MatchRecord
  flag: FieldFlag
  /** The section's news for this card ("this reading changed"), or ''. */
  notice: string
  /** A write for this card is on the wire. */
  busy: boolean
}>()

const emit = defineEmits<{
  confirm: []
  unconfirm: []
  /** A value to write in place of the reading. */
  write: [string]
}>()

const { writesLocked, lockReason, sessionActive } = useWriteGate()
const regions = useFieldRegionsQuery(props.rec.match_key, () => !sessionActive.value)

const label = computed(() => fieldLabel(props.flag.field, props.rec.data))
const matchName = computed(() =>
  [props.rec.data.date, props.rec.data.map].filter(Boolean).join(' · ') || props.rec.match_key)
const editKind = computed(() => flagEditKind(props.rec, props.flag.field))
const others = computed(() => otherReadings(props.rec, props.flag))
const crops = computed(() => (regions.data.value ?? []).filter((r) => r.field === props.flag.field))
const noCrop = computed(() => regions.isSuccess.value && crops.value.length === 0)
const lockTitle = computed(() => lockReason.value || undefined)

const editing = ref(false)
const draft = ref('')
const draftValid = computed(() => withFlaggedValue(props.rec, props.flag.field, draft.value) !== null)
const inputId = useId()
const hintId = useId()

// Edit and Cancel each unmount the control holding focus, so each hands it
// on: into the field it opened, or back to the Edit that opened it.
const draftField = useTemplateRef<HTMLInputElement | HTMLSelectElement>('draftField')
const editButton = useTemplateRef<HTMLButtonElement>('editButton')
async function startEdit() {
  draft.value = props.flag.value
  editing.value = true
  await nextTick()
  draftField.value?.focus()
}
async function cancelEdit() {
  editing.value = false
  await nextTick()
  editButton.value?.focus()
}
function save() {
  if (!draftValid.value || props.busy) return
  emit('write', draft.value)
}
function ask(action: () => void) {
  if (!props.busy) action()
}
</script>

<template>
  <article
    class="unknown-card field-flag-card"
    :class="{ 'field-flag-settled': flag.state !== 'open' }"
    tabindex="-1"
    :aria-label="`Flagged reading: ${label} — ${matchName}`"
  >
    <div class="unknown-card-head">
      <div class="unknown-head-lhs">
        <span class="unknown-key-block">
          <span class="unknown-key">{{ label }}</span>
          <span class="unknown-src-count">{{ matchName }}</span>
        </span>
      </div>
      <span v-if="flag.state !== 'open'" class="eyebrow field-flag-state">
        {{ flag.state === 'confirmed' ? 'Confirmed' : 'Edited' }}
      </span>
    </div>

    <div class="field-flag-body stack">
      <p class="field-flag-reads">
        Reads <strong class="mono">{{ flag.value || '—' }}</strong>
      </p>
      <p v-for="check in flag.checks" :key="check" class="field-flag-why">
        {{ CHECK_LABEL[check] }}
      </p>
      <ul class="field-flag-readings" aria-label="Readings compared">
        <li v-for="reading in flag.readings" :key="`${reading.origin} ${reading.source_file} ${reading.value}`">
          <span class="mono">{{ reading.value || '—' }}</span> — {{ readingSource(reading) }}
        </li>
      </ul>

      <div class="field-flag-crops cluster">
        <p v-if="sessionActive" class="field-flag-hint">
          Screenshots aren't included in a coaching session.
        </p>
        <SourceCrop
          v-for="r in crops"
          :key="`${r.source_file} ${r.x} ${r.y} ${r.width} ${r.height}`"
          :region="r"
          :label="label"
        />
        <p v-if="noCrop" class="field-flag-hint">
          No crop recorded for this reading — Re-parse All records where each field was read.
        </p>
      </div>

      <p role="status" class="field-flag-news">
        {{ notice }}
      </p>

      <div v-if="flag.state === 'open'" class="field-flag-actions cluster">
        <button
          type="button"
          class="btn-mono is-primary"
          :aria-label="`Confirm as read: ${label} ${flag.value}`"
          :disabled="writesLocked"
          :aria-disabled="busy || undefined"
          :title="lockTitle"
          @click="ask(() => emit('confirm'))"
        >
          Confirm as read
        </button>
        <button
          v-for="reading in others"
          :key="reading.value"
          type="button"
          class="btn-mono"
          :aria-label="`Use ${reading.value} (${readingSource(reading)})`"
          :disabled="writesLocked"
          :aria-disabled="busy || undefined"
          :title="lockTitle"
          @click="ask(() => emit('write', reading.value))"
        >
          Use {{ reading.value }}
        </button>
        <button
          v-if="editKind && !editing"
          ref="editButton"
          type="button"
          class="btn-mono"
          :aria-label="`Edit ${label}`"
          :disabled="writesLocked"
          :title="lockTitle"
          @click="startEdit"
        >
          Edit
        </button>
        <p v-if="!editKind" class="field-flag-hint">
          Change it in the match's own detail if it's wrong.
        </p>
      </div>

      <form v-if="flag.state === 'open' && editKind && editing" class="field-flag-edit cluster" @submit.prevent="save">
        <label :for="inputId" class="field-flag-edit-label">Corrected {{ label }}</label>
        <select v-if="editKind === 'result'" :id="inputId" ref="draftField" v-model="draft">
          <option v-for="result in RESULTS" :key="result" :value="result">
            {{ result }}
          </option>
        </select>
        <input
          v-else
          :id="inputId"
          ref="draftField"
          v-model="draft"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          class="mono field-flag-input"
          :aria-describedby="draftValid ? undefined : hintId"
        >
        <button type="submit" class="btn-mono is-primary" :disabled="!draftValid || writesLocked" :title="lockTitle">
          Save
        </button>
        <button type="button" class="btn-mono" @click="cancelEdit">
          Cancel
        </button>
        <p v-if="!draftValid" :id="hintId" class="field-flag-hint">
          {{ editKind === 'result' ? 'Pick a result.' : 'Enter a whole number.' }}
        </p>
      </form>

      <div v-if="flag.state === 'confirmed'" class="field-flag-actions cluster">
        <button
          type="button"
          class="btn-mono"
          :aria-label="`Re-open ${label}`"
          :disabled="writesLocked"
          :aria-disabled="busy || undefined"
          :title="lockTitle"
          @click="ask(() => emit('unconfirm'))"
        >
          Re-open
        </button>
      </div>
      <p v-if="flag.state === 'edited'" class="field-flag-hint">
        Settled by your edit — revert the edit in the match to review it again.
      </p>
    </div>
  </article>
</template>

<style scoped>
/* A settled card reads as settled: the bar goes quiet. Not an opacity dim —
   the card holds small text and live controls (the reference-gap card's
   lesson: composited text at 60% fell below AA). */
.field-flag-settled::before {
  background: var(--border-soft);
}

/* Focus lands on the card when a settle moves the one before it away. */
.field-flag-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.unknown-card-head {
  cursor: default;
}

.field-flag-body {
  padding: 0 var(--space-4) var(--space-4) var(--space-6);
}

.field-flag-reads,
.field-flag-why,
.field-flag-news,
.field-flag-hint {
  margin: 0;
}

.field-flag-reads {
  font-size: var(--type-lg);
  color: var(--text);
}

.field-flag-why,
.field-flag-readings {
  font-size: var(--type-md);
  color: var(--text-dim);
}

.field-flag-readings {
  margin: 0;
  padding-left: var(--space-4);
}

.field-flag-hint {
  font-size: var(--type-sm);
  color: var(--text-dim);
}

.field-flag-news {
  font-size: var(--type-md);
  color: var(--text);
}

.field-flag-state {
  flex: none;
  color: var(--text-dim);
}

.field-flag-edit-label {
  font-size: var(--type-md);
  color: var(--text);
}

.field-flag-input {
  width: 8ch;
}
</style>
