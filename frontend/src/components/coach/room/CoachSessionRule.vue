<script setup lang="ts">
// The session rule: a hatched paper strip that runs under the masthead on
// every tab while a bundle is open.
//
// It is deliberately DECORATION — the loan slip above it and the nav strip
// below it carry every word a screen reader needs, and a third
// announcement of the same fact on every view would be noise. What it
// carries is the visual one: the whole page is on loan, not just the room.
// The data attribute is the e2e's handle for "the session chrome is up".
</script>

<template>
  <div class="coach-session-rule paper-rule-hatch" data-coach-session-rule aria-hidden="true" />
</template>

<style scoped>
.coach-session-rule {
  height: 0.35rem;
  margin: 0 0 var(--space-3);
  border-top: 1px solid var(--paper-edge);
  border-bottom: 1px solid var(--paper-edge);
}
</style>
