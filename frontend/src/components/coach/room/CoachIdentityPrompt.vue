<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from 'vue'

// "Bundle suggests, coach confirms." A share-with-a-coach export names its
// player; a plain one does not, and until the coach says who this is, every
// note the server is asked to keep comes back 409. So the room asks — here,
// on paper, at the top of the desk where the writing happens.
//
// It is also the CORRECTION surface: a suggested handle is a suggestion,
// and the session sheet re-opens this to change it.

const props = withDefaults(defineProps<{
  /** The handle to start from — the bundle's suggestion, or '' for nobody. */
  handle?: string
  /** True while no handle is confirmed at all, which is the blocking case. */
  unconfirmed?: boolean
}>(), { handle: '', unconfirmed: false })

const emit = defineEmits<{
  confirm: [handle: string]
  cancel: []
}>()

const typed = ref(props.handle)
const handleField = useTemplateRef<HTMLInputElement>('handleField')

// The blocking case owns the coach's next action, so it takes focus. A
// correction was opened deliberately from the sheet and takes it too.
onMounted(() => handleField.value?.focus())

function confirm(): void {
  const next = typed.value.trim()
  if (next === '') return
  emit('confirm', next)
}
</script>

<template>
  <section class="paper coach-identity" aria-labelledby="coach-identity-title">
    <h3 id="coach-identity-title" class="identity-title">
      Who is this?
    </h3>
    <p class="identity-copy">
      <template v-if="unconfirmed">
        This bundle did not say who it belongs to. Notes are filed under the
        name you give here and come back the next time you open their bundle —
        nothing can be saved until then.
      </template>
      <template v-else>
        The bundle suggested this name. Change it and the notes re-file under
        the corrected player.
      </template>
    </p>

    <form class="identity-form" @submit.prevent="confirm">
      <label class="eyebrow ink identity-label" for="coach-identity-handle">
        Player handle
      </label>
      <div class="identity-row">
        <input
          id="coach-identity-handle"
          ref="handleField"
          v-model="typed"
          type="text"
          class="identity-input"
          autocomplete="off"
          spellcheck="false"
          placeholder="Their handle"
        >
        <button type="submit" class="paper-btn primary" :disabled="typed.trim() === ''">
          Confirm
        </button>
        <button v-if="!unconfirmed" type="button" class="paper-btn" @click="emit('cancel')">
          Keep {{ handle }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.coach-identity {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.9rem 1rem 1rem;
  border: 2px solid var(--paper-accent);
}

.identity-title {
  margin: 0;
  font-family: var(--display);
  font-style: italic;
  font-size: 1.9rem;
  font-weight: 800;
  line-height: 1;
  color: var(--ink);
  text-transform: uppercase;
}

.identity-copy {
  margin: 0;
  font-size: var(--type-lg);
  line-height: 1.5;
  color: var(--ink-dim);
}

.identity-form {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.2rem;
}

.identity-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.identity-input {
  flex: 1 1 10rem;
  padding: 0.35rem 0.55rem;
  font-family: var(--body);
  font-size: var(--type-lg);
  color: var(--ink);
  background: var(--paper-2);
  border: 1px solid var(--ink-faint);
  border-radius: var(--radius);
}
</style>
