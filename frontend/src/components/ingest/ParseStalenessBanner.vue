<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import { useParseStalenessNotice } from '@/composables/ingest/useParseStalenessNotice'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { useParseStore } from '@/stores/parse'

// "42 matches were read by an older parser · Re-parse all now" — the notice
// that a parser improvement has not reached the existing history yet.
//
// It sits above the dossier because the numbers immediately below it are the
// ones a stale reading distorts: a win-rate or rank chart drawn across two
// parser vintages mixes them with nothing to indicate it. Settings → Advanced
// already held the cure; what was missing was any reason to go looking.
const { staleMatches, shouldShow, dismiss } = useParseStalenessNotice()

const parse = useParseStore()
const { parseBusy } = storeToRefs(parse)
const { writesLocked, lockedTitle } = useWriteGate()

const line = computed(() =>
  `${staleMatches.value} ${staleMatches.value === 1 ? 'match was' : 'matches were'} `
  + 'read by an older parser — a re-parse would correct them.')

// The frontend gate is defense in depth (the server refuses the same write
// with a 409), but a button that stays enabled is still a lie to the user.
const disabled = computed(() => writesLocked.value || parseBusy.value)
</script>

<template>
  <div
    v-if="shouldShow"
    class="parse-stale"
    role="status"
    aria-label="Matches read by an older parser"
  >
    <span class="eyebrow accent parse-stale-eyebrow">Parser</span>
    <span class="parse-stale-line">{{ line }}</span>
    <button
      type="button"
      class="btn ghost parse-stale-cta"
      :disabled="disabled"
      :title="lockedTitle('Re-run OCR on every screenshot')"
      @click="parse.onReParseAll()"
    >
      {{ parseBusy ? 'Re-parsing…' : 'Re-parse all now' }}
    </button>
    <button
      type="button"
      class="btn ghost parse-stale-dismiss"
      aria-label="Dismiss this notice until the next parser update"
      @click="dismiss"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
/* Layout only — the type comes from .eyebrow.accent and .btn.ghost so this
   notice cannot drift from the coaching banner it sits beside. */
.parse-stale {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.7rem;
  padding: 0.5rem 0.75rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
}

.parse-stale-eyebrow { flex: none; }

.parse-stale-line {
  flex: 1 1 auto;
  font-size: var(--type-lg);
  color: var(--text);
}

.parse-stale-cta,
.parse-stale-dismiss { flex: none; }
</style>
