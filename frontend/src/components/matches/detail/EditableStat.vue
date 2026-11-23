<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'

import type { FieldFlag } from '@/api-client'
import SourceCrop from '@/components/shared/SourceCrop.vue'
import type { StatSource } from '@/match/quality/crop-sources'

// One inline-editable stat cell: shows a value + label like the static
// `.stat` block, but the value is a button that swaps into an input on click
// (Enter / blur commits, Esc cancels). When the field carries a user override
// a ✎ marker appears beside the label; clicking it reverts that field to the
// scanned (OCR) value. Generic: the parent owns the field→override mapping and
// reacts to `commit` / `revert`.
//
// Beside the value, two things the parse knows about it: where on the match's
// screenshots it was read ("Show source" reveals those crops), and whether the
// cross-check doubted it. A doubted value is still shown as READ — the stats
// leave it out, but this cell is where the player decides what it should be.

const SOURCE_NOTE = {
  pending: 'Loading where this value was read…',
  error: "Couldn't load where this value was read.",
  ready: 'No crop recorded for this value — Re-parse All records where each value was read.',
} as const

const props = withDefaults(
  defineProps<{
    value: number | string | null | undefined
    label: string
    edited?: boolean
    kind?: 'number' | 'text'
    // Inclusive numeric bounds enforced on commit (kind === 'number' only).
    // Default to the MatchResult stat range so a negative or absurd value is
    // rejected before it reaches the server. Override per stat as needed.
    min?: number
    max?: number
    // Optional display formatter (e.g. thousands separators for damage).
    format?: (v: number | string) => string
    // The owning card's write gate, threaded down as plain props so this
    // generic cell stays free of app state: the value still READS, the edit
    // affordance goes dead and says why.
    locked?: boolean
    lockReason?: string
    /** Where on the match's screenshots this value was read; null offers no disclosure. */
    source?: StatSource | null
    /** The cross-check's flag on this value; an open one keeps it out of the stats. */
    flag?: Pick<FieldFlag, 'state'> | null
    /** What a sibling's open flag that leaves this value out too is called, or ''. */
    leftOutWith?: string
  }>(),
  {
    edited: false, kind: 'number', min: 0, max: 1_000_000,
    format: (v: number | string) => String(v),
    locked: false, lockReason: '',
    source: null, flag: null, leftOutWith: '',
  },
)

const emit = defineEmits<{
  commit: [value: number | string]
  revert: []
  /** Asks for the flagged reading's review, which the Unknown tab holds. */
  review: []
  /** The disclosure opened: the owner asks where the value was read. */
  'show-source': []
}>()

const flagged = computed(() => props.flag?.state === 'open')
const leftOutNote = computed(() => {
  if (flagged.value) return 'Left out of stats — needs review'
  return props.leftOutWith ? `Left out of stats — ${props.leftOutWith} needs review` : ''
})
const flagId = useId()
// Collapsed by default: each crop loads the whole screenshot behind it.
const sourceOpen = ref(false)
const sourceId = useId()
const crops = computed(() => (props.source?.status === 'ready' ? props.source.crops : []))
function toggleSource() {
  sourceOpen.value = !sourceOpen.value
  if (sourceOpen.value) emit('show-source')
}

const editing = ref(false)
const draft = ref('')
const error = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

const displayValue = computed(() => {
  if (props.value === null || props.value === undefined || props.value === '') return '—'
  return props.format(props.value)
})

async function startEdit() {
  if (props.locked) return
  draft.value = props.value === null || props.value === undefined ? '' : String(props.value)
  error.value = ''
  editing.value = true
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
}

function commit() {
  if (!editing.value) return
  // v-model on <input type="number"> hands back a number, so coerce before
  // trimming (draft is typed string but the runtime value can be numeric).
  const raw = String(draft.value).trim()
  if (raw === '') {
    editing.value = false
    return
  }
  if (props.kind !== 'number') {
    editing.value = false
    emit('commit', raw)
    return
  }
  const n = Number(raw)
  if (Number.isNaN(n)) {
    editing.value = false
    return
  }
  if (n < props.min || n > props.max) {
    // Reject out of range: surface an inline error and keep the field open so
    // the user can correct it rather than silently dropping the edit.
    error.value = `Enter a number from ${props.min} to ${props.max.toLocaleString()}.`
    return
  }
  error.value = ''
  editing.value = false
  emit('commit', n)
}

function cancel() {
  error.value = ''
  editing.value = false
}
</script>

<template>
  <div class="stat editable-stat" :class="{ 'is-edited': edited }">
    <input
      v-if="editing"
      ref="inputRef"
      v-model="draft"
      class="stat-input"
      :type="kind === 'number' ? 'number' : 'text'"
      spellcheck="false"
      autocomplete="off"
      autocorrect="off"
      :min="kind === 'number' ? min : undefined"
      :max="kind === 'number' ? max : undefined"
      :aria-label="`Edit ${label}`"
      :aria-invalid="error ? 'true' : undefined"
      @keydown.enter.prevent="commit"
      @keydown.esc.prevent="cancel"
      @blur="commit"
    >
    <button
      v-else
      type="button"
      class="stat-value stat-edit-trigger"
      :disabled="locked"
      :title="lockReason || undefined"
      :aria-label="`${label}: ${displayValue}. Click to edit.`"
      :aria-describedby="leftOutNote ? flagId : undefined"
      @click="startEdit"
    >
      {{ displayValue }}
    </button>

    <span v-if="error" class="stat-error" role="alert">{{ error }}</span>

    <span class="stat-label">
      {{ label }}
      <button
        v-if="edited"
        type="button"
        class="stat-revert"
        :disabled="locked"
        :aria-label="`Revert ${label} to the scanned value`"
        :title="lockReason || 'Edited — click to revert to the scanned value'"
        @click="emit('revert')"
      >✎</button>
    </span>

    <span v-if="leftOutNote" :id="flagId" class="stat-flag">{{ leftOutNote }}</span>
    <button
      v-if="flagged && !locked"
      type="button"
      class="btn-mono is-text is-sm stat-aside"
      :aria-label="`Review ${label} in Unknown`"
      @click="emit('review')"
    >
      Review
    </button>

    <template v-if="source">
      <button
        type="button"
        class="btn-mono is-text is-sm stat-aside"
        :aria-expanded="sourceOpen"
        :aria-controls="sourceId"
        :aria-label="`Show source of ${label}`"
        @click="toggleSource"
      >
        Show source
      </button>
      <div :id="sourceId" class="stat-source stack gap-1">
        <template v-if="sourceOpen">
          <figure
            v-for="({ region: r, caption }, i) in crops"
            :key="`${r.source_file} ${r.x} ${r.y} ${r.width} ${r.height}`"
            class="stat-crop stack gap-1"
            :aria-labelledby="`${sourceId}-${i}`"
          >
            <SourceCrop :region="r" :label="label" />
            <figcaption :id="`${sourceId}-${i}`" class="stat-crop-caption">
              {{ caption }}
            </figcaption>
          </figure>
          <p v-if="crops.length === 0" class="stat-source-note">
            {{ SOURCE_NOTE[source.status] }}
          </p>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* The trigger button inherits the global .stat-value type styling; strip the
   UA button chrome so only that styling shows (the :where reset elsewhere in
   the panel keeps specificity at 0, but this component owns its own button). */
.stat-edit-trigger {
  appearance: none;
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
  cursor: pointer;
  border-bottom: 1px dashed transparent;
}

.stat-edit-trigger:hover {
  border-bottom-color: var(--accent-soft);
}

.stat-edit-trigger:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.editable-stat.is-edited .stat-value {
  color: var(--accent-text);
}

.stat-input {
  width: 100%;
  max-width: 6ch;
  font-family: var(--mono);
  font-size: var(--type-5xl);
  font-weight: 700;
  text-align: center;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  padding: var(--space-0-5) var(--space-0-5);
}

.stat-input[aria-invalid='true'] {
  border-color: var(--loss);
}

/* Out-of-range message under the input; small + loss-colored so it reads as a
   correction prompt without shoving the stats grid around. */
.stat-error {
  display: block;
  margin-top: var(--space-0-5);
  font-size: var(--type-2xs);
  line-height: 1.1;
  color: var(--loss);
  max-width: 14ch;
}

/* A doubted value: the line says why the stats leave it out. */
.stat-flag {
  display: block;
  margin-top: var(--space-1);
  font-size: var(--type-2xs);
  line-height: 1.2;
  color: var(--accent-text);
  max-width: 16ch;
}

/* Review and Show source sit flush under the label they belong to. */
.stat-aside {
  margin-top: var(--space-1);
  margin-left: calc(-1 * var(--space-2));
}

.stat-source {
  width: 100%;
}

.stat-crop {
  margin: 0;
}

/* Which screen a crop was cut from, so two stacked crops tell apart. */
.stat-crop-caption,
.stat-source-note {
  margin: 0;
  font-size: var(--type-2xs);
  line-height: 1.2;
  color: var(--text-dim);
}

/* The ✎ revert affordance sits inline after the label. Accent-colored so an
   edited field reads at a glance; the whole marker is the revert button. */
.stat-revert {
  appearance: none;
  background: none;
  border: 0;
  padding: 0 0 0 var(--space-1);
  margin: 0;
  font-size: var(--type-sm);
  line-height: 1;
  color: var(--accent-text);
  cursor: pointer;
}

.stat-revert:hover {
  color: var(--accent-bright);
}

.stat-revert:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}
</style>
