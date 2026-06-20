<script setup lang="ts">
// A single multi-select chip-cloud facet for the Narrow panel: an eyebrow + a
// "N picked / any" meta line + a wrap of toggle chips, one per option. Used for
// the uniform dynamic facets (Game Mode, Role, Result, Rank, Modifiers, …). The
// label slot defaults to the raw option; pass it for prefixed/mapped labels.
// Chrome (np-section / np-chip families) lives in the global narrow.css.
defineProps<{
  eyebrow: string
  options: readonly string[]
  picked: Set<string>
  // Shown in place of the chip cloud when there are no options. Omit to render
  // nothing (the section header still shows "any").
  emptyMessage?: string
}>()
const emit = defineEmits<{ pick: [value: string] }>()
</script>

<template>
  <section class="np-section">
    <div class="np-section-head">
      <span class="np-section-eyebrow">{{ eyebrow }}</span>
      <span class="np-section-meta">{{ picked.size ? `${picked.size} picked` : 'any' }}</span>
    </div>
    <div class="np-chips">
      <button
        v-for="o in options"
        :key="o"
        class="np-chip"
        :class="{ picked: picked.has(o) }"
        @click="emit('pick', o)"
      >
        <slot name="label" :option="o">
          {{ o }}
        </slot>
      </button>
      <span v-if="!options.length && emptyMessage" class="np-empty">{{ emptyMessage }}</span>
    </div>
  </section>
</template>
