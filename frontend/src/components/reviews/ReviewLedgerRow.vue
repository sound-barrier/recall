<script setup lang="ts">
// One row of a reviews ledger: a line of text and, usually, one way to act on
// it. Four lists on the index wear this shape — notes waiting on a decision,
// sets you have sent, sittings you decided but did not card, and the players on
// your roster — and each spelled the same `<li>`/`<span>`/class pair out again.
//
// `quiet` is the receipt variant: a row that records something rather than
// asking for something. The waiting list is the only one that is a task, so it
// is the only one that is not quiet.

defineProps<{ quiet?: boolean }>()
</script>

<template>
  <li class="reviews-waiting-row" :class="{ 'reviews-skipped-row': quiet }">
    <slot name="eyebrow" />
    <span class="reviews-waiting-line"><slot /></span>
    <slot name="action" />
    <!-- Full-width content under the row's line — the roster's dossier. -->
    <slot name="below" />
  </li>
</template>
