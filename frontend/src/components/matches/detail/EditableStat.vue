<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

// One inline-editable stat cell: shows a value + label like the static
// `.stat` block, but the value is a button that swaps into an input on click
// (Enter / blur commits, Esc cancels). When the field carries a user override
// a ✎ marker appears beside the label; clicking it reverts that field to the
// scanned (OCR) value. Generic: the parent owns the field→override mapping and
// reacts to `commit` / `revert`.
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
  }>(),
  { edited: false, kind: 'number', min: 0, max: 1_000_000, format: (v: number | string) => String(v) },
)

const emit = defineEmits<{
  commit: [value: number | string]
  revert: []
}>()

const editing = ref(false)
const draft = ref('')
const error = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

const displayValue = computed(() => {
  if (props.value === null || props.value === undefined || props.value === '') return '—'
  return props.format(props.value)
})

async function startEdit() {
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
      :aria-label="`${label}: ${displayValue}. Click to edit.`"
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
        :aria-label="`Revert ${label} to the scanned value`"
        title="Edited — click to revert to the scanned value"
        @click="emit('revert')"
      >✎</button>
    </span>
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
  color: var(--accent);
}

.stat-input {
  width: 100%;
  max-width: 6ch;
  font-family: var(--mono);
  font-size: 1.3rem;
  font-weight: 700;
  text-align: center;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 2px;
  padding: 0.05rem 0.1rem;
}

.stat-input[aria-invalid='true'] {
  border-color: var(--loss);
}

/* Out-of-range message under the input; small + loss-coloured so it reads as a
   correction prompt without shoving the stats grid around. */
.stat-error {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.6rem;
  line-height: 1.1;
  color: var(--loss);
  max-width: 14ch;
}

/* The ✎ revert affordance sits inline after the label. Accent-coloured so an
   edited field reads at a glance; the whole marker is the revert button. */
.stat-revert {
  appearance: none;
  background: none;
  border: 0;
  padding: 0 0 0 0.25rem;
  margin: 0;
  font-size: 0.7rem;
  line-height: 1;
  color: var(--accent);
  cursor: pointer;
}

.stat-revert:hover {
  color: var(--accent-bright, var(--accent));
}

.stat-revert:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}
</style>
