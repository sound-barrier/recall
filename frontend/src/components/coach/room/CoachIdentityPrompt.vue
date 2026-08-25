<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue'

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
  /** Where the corpus came from — a codes coach has no bundle to be told about. */
  source?: 'bundle' | 'replay'
}>(), { handle: '', unconfirmed: false, source: 'bundle' })

const emit = defineEmits<{
  confirm: [handle: string, kind: 'player' | 'team']
  cancel: []
}>()

// The fork: six characters can belong to a TEAM — one shared review filed
// under the group's name. Codes only; a bundle already named its player,
// so the fork never renders there and the emit pins kind to player.
const kind = ref<'player' | 'team'>('player')
const forked = computed(() => props.source === 'replay')
const noun = computed(() => (forked.value && kind.value === 'team' ? 'team' : 'player'))

function pickKind(next: 'player' | 'team'): void {
  kind.value = next
  handleField.value?.focus()
}

// The pair moves like a radio group: arrows move AND select.
function onKindArrow(e: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
  e.preventDefault()
  const next = kind.value === 'player' ? 'team' : 'player'
  kind.value = next
  const sel = `[data-kind="${next}"]`
  ;(e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(sel)?.focus()
}

const typed = ref(props.handle)
const handleField = useTemplateRef<HTMLInputElement>('handleField')

// The blocking case owns the coach's next action, so it takes focus. A
// correction was opened deliberately from the sheet and takes it too.
onMounted(() => handleField.value?.focus())

function confirm(): void {
  const next = typed.value.trim()
  if (next === '') return
  emit('confirm', next, forked.value ? kind.value : 'player')
}
</script>

<template>
  <section class="paper coach-identity" aria-labelledby="coach-identity-title">
    <h3 id="coach-identity-title" class="identity-title">
      Who is this?
    </h3>
    <div
      v-if="forked"
      class="identity-kind"
      role="radiogroup"
      aria-label="Who this review is about"
      @keydown="onKindArrow"
    >
      <button
        type="button"
        class="paper-chip"
        role="radio"
        data-kind="player"
        :aria-checked="kind === 'player'"
        :tabindex="kind === 'player' ? 0 : -1"
        @click="pickKind('player')"
      >
        One player
      </button>
      <button
        type="button"
        class="paper-chip"
        role="radio"
        data-kind="team"
        :aria-checked="kind === 'team'"
        :tabindex="kind === 'team' ? 0 : -1"
        @click="pickKind('team')"
      >
        A team
      </button>
    </div>
    <p class="identity-copy">
      <template v-if="unconfirmed && source === 'replay'">
        Nothing said who these codes are about. Notes are filed under the
        name you give here and come back the next time you review this
        {{ noun }} — nothing can be saved until then.
      </template>
      <template v-else-if="unconfirmed">
        This bundle did not say who it belongs to. Notes are filed under the
        name you give here and come back the next time you review this
        player — nothing can be saved until then.
      </template>
      <template v-else-if="source === 'replay'">
        Change the name and the notes re-file under the corrected player.
      </template>
      <template v-else>
        The bundle suggested this name. Change it and the notes re-file under
        the corrected player.
      </template>
    </p>

    <form class="identity-form" @submit.prevent="confirm">
      <label class="eyebrow ink identity-label" for="coach-identity-handle">
        {{ noun === 'team' ? 'Team name' : 'Player handle' }}
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
          :placeholder="noun === 'team' ? 'The team\'s name' : 'Their handle'"
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

.identity-kind {
  display: flex;
  gap: 0.35rem;
  margin: 0.15rem 0 0.35rem;
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
