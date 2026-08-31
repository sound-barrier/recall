<script setup lang="ts">
import type { MatchRecord } from '@/api-client'

// One reference-data-gap card: the record's file, the OCR'd hero/map the
// shipped roster doesn't know, and the one action that fits its state.
// Active and acknowledged cards are the same card — the acknowledged one
// simply offers the way back — so they are one component rather than two
// near-identical blocks in the section.
defineProps<{
  rec: MatchRecord
  acknowledged: boolean
  /** The release that would recognize this name, when one is known. */
  recognizing: { version: string; url: string; name: string } | null
  writesLocked: boolean
  lockReason: string
}>()

const emit = defineEmits<{
  /** true = dismiss the warning, false = show it again. */
  acknowledge: [boolean]
}>()
</script>

<template>
  <article
    class="unknown-card reference-gap-card"
    :class="{ 'refgap-acked-card': acknowledged }"
    :data-reference-gap-key="rec.match_key"
  >
    <div class="unknown-card-head">
      <div class="unknown-head-lhs">
        <span class="unknown-key-block">
          <span class="unknown-key mono">{{ rec.source_files?.[0] ?? rec.match_key }}</span>
          <span class="unknown-src-count">
            <template v-if="rec.data?.hero_raw">Unknown hero: <code>{{ rec.data.hero_raw }}</code></template>
            <template v-if="rec.data?.hero_raw && rec.data?.map_raw">  ·  </template>
            <template v-if="rec.data?.map_raw">Unknown map: <code>{{ rec.data.map_raw }}</code></template>
          </span>
        </span>
      </div>
      <div class="unknown-head-rhs">
        <button
          v-if="acknowledged"
          type="button"
          class="btn"
          :aria-label="`Show the warning for ${rec.match_key} again`"
          :disabled="writesLocked"
          :title="lockReason || undefined"
          @click="emit('acknowledge', false)"
        >
          Show again
        </button>
        <!-- One click, no armed confirm: the disclosure below restores it. -->
        <button
          v-else
          type="button"
          class="unknown-delete-btn"
          :aria-label="`Dismiss the warning for ${rec.match_key}`"
          :disabled="writesLocked"
          :title="lockReason || 'The match keeps its data; a future update can still fix it.'"
          @click="emit('acknowledge', true)"
        >
          Dismiss
        </button>
      </div>
    </div>
    <p
      v-if="!acknowledged && recognizing"
      class="reference-gap-fix"
      :data-fix-cta-key="rec.match_key"
    >
      <span class="eyebrow accent fix-eyebrow">Fixed in</span>
      <a
        class="fix-link"
        :href="recognizing.url"
        target="_blank"
        rel="noopener noreferrer"
        :title="`Open release page for v${recognizing.version}`"
      >v{{ recognizing.version }} ↗</a>
      <span class="fix-copy">
        — will recognize
        <code>{{ recognizing.name }}</code>
      </span>
    </p>
  </article>
</template>

<style scoped>
/* Acknowledged cards read as settled: the accent bar goes quiet.
   Deliberately NOT an opacity dim — the card holds small text and a
   live control, and composited text at 60% opacity fell below AA. */
.refgap-acked-card {
  border-left-color: var(--border-soft);
}
</style>
