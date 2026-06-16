<script setup lang="ts">
import { ref } from 'vue'

// One drop-zone on the pivot builder (Rows / Columns / Values / Filters,
// or the source field tray). Owns only its hover-highlight + drop plumbing;
// the chips themselves are slotted in by the parent, which also decides
// what a drop means. The dragged payload rides on text/plain (the most
// portable dataTransfer type, and the one Playwright's drag simulation
// carries through).
defineProps<{
  zone: string
  label: string
  hint?: string
  empty?: boolean
}>()

const emit = defineEmits<{ 'drop-field': [payload: string] }>()

const over = ref(false)

function onDrop(e: DragEvent) {
  over.value = false
  const payload = e.dataTransfer?.getData('text/plain')
  if (payload) emit('drop-field', payload)
}
</script>

<template>
  <section
    class="pivot-shelf"
    :class="[`pivot-shelf--${zone}`, { 'pivot-shelf--over': over }]"
    :data-pivot-zone="zone"
    :aria-label="label"
    @dragover.prevent="over = true"
    @dragenter.prevent="over = true"
    @dragleave="over = false"
    @drop.prevent="onDrop"
  >
    <header class="pivot-shelf-eyebrow">
      {{ label }}
    </header>
    <div class="pivot-shelf-body">
      <slot />
      <p v-if="empty" class="pivot-shelf-empty">
        {{ hint ?? 'Drop a field' }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.pivot-shelf {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-height: 3.5rem;
  padding: 0.5rem 0.55rem 0.6rem;
  border: 1px dashed color-mix(in srgb, var(--border-strong) 70%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--surface-2) 55%, transparent);
  transition: border-color 120ms ease, background 120ms ease;
}

/* The active drop target lifts with the app's accent wash — the same
   hover idiom used on rows + sortable headers. */
.pivot-shelf--over {
  border-color: var(--accent);
  border-style: solid;
  background: color-mix(in srgb, var(--accent) 8%, var(--surface-2));
}

.pivot-shelf--tray {
  border-style: solid;
  border-color: color-mix(in srgb, var(--border) 60%, transparent);
}

.pivot-shelf-eyebrow {
  font-family: var(--mono);
  font-size: 0.54rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-faint);
}

.pivot-shelf-body {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: flex-start;
}

.pivot-shelf-empty {
  margin: 0;
  padding: 0.1rem 0;
  font-family: var(--mono);
  font-size: 0.6rem;
  font-style: italic;
  color: var(--text-dim);
}
</style>
