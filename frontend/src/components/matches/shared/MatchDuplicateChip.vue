<script setup lang="ts">
import { useUiStore } from '@/stores/ui'

// "Possible duplicate of →" — the verdict the user already reached, on both
// cards, each naming the other.
//
// A judgment about a PAIR is only checkable by looking at both, so the chip
// is a button that goes there rather than a label that states it. It lives
// in matches/shared because the row and the detail panel both show it and
// the wording has to be the same in both: the row is where you notice it,
// the panel is where you act on it.
const props = defineProps<{
  // Every match this one was judged separate from. Symmetric on the wire,
  // so a card's twin carries the mirror of this list.
  duplicateOf: string[]
}>()

const ui = useUiStore()

// The key is a timestamp, and the whole point of following the link is to
// compare — so the chip says WHEN, which is the thing that made the two
// look alike in the first place.
function label(key: string): string {
  return `Possible duplicate of ${key}`
}

// revealMatch resets the narrow when the twin is filtered out of the
// current set: a link the user can see and not follow would be worse than
// no link, and the twin is by construction a match they own.
function open(key: string) {
  ui.revealMatch(key)
}
</script>

<template>
  <button
    v-for="key in props.duplicateOf"
    :key="key"
    type="button"
    class="badge dup-chip"
    :data-duplicate-of="key"
    :aria-label="label(key)"
    :title="`${label(key)} — judged a different match. Open it to compare.`"
    @click.stop="open(key)"
  >
    ⧉ duplicate?
  </button>
</template>

<style scoped>
/* Reads as a quieter sibling of the tag chips it sits beside — this is a
   note about the match, not a property of it. */
.dup-chip {
  appearance: none;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
}

.dup-chip:hover {
  color: var(--accent-text);
  border-color: var(--accent);
  background: var(--accent-soft);
}
</style>
