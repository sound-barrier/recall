<script setup lang="ts">
// A single multi-select chip-cloud facet for the Narrow panel: an eyebrow + a
// meta line + a wrap of toggle chips, one per option. Drives every multi-select
// facet — dynamic ones (Game Mode, Role, Tags, …) pass plain string options;
// fixed-enum ones (Queue, Play mode, Reviewed by, …) pass { value, label }
// options. The label slot overrides the rendered text (prefixes, mapped labels);
// chrome (np-section / np-chip families) lives in the global narrow.css.
type ChipOption = string | { value: string; label: string }

defineProps<{
  eyebrow: string
  options: readonly ChipOption[]
  picked: Set<string>
  // Override the default "N picked / any" meta (e.g. the "N selected" enums).
  meta?: string
  // Shown in place of the chip cloud when there are no options.
  emptyMessage?: string
  // Optional data-* attribute name set on each chip (value = the option value),
  // for e2e targeting (e.g. "data-member", "data-queue-type").
  dataAttr?: string
}>()
const emit = defineEmits<{ pick: [value: string] }>()

const optValue = (o: ChipOption): string => (typeof o === 'string' ? o : o.value)
const optLabel = (o: ChipOption): string => (typeof o === 'string' ? o : o.label)
</script>

<template>
  <section class="np-section">
    <div class="np-section-head">
      <span class="np-section-eyebrow">{{ eyebrow }}</span>
      <span class="np-section-meta">{{ meta ?? (picked.size ? `${picked.size} picked` : 'any') }}</span>
    </div>
    <div class="np-chips">
      <button
        v-for="o in options"
        :key="optValue(o)"
        class="np-chip"
        :class="{ picked: picked.has(optValue(o)) }"
        v-bind="dataAttr ? { [dataAttr]: optValue(o) } : {}"
        @click="emit('pick', optValue(o))"
      >
        <slot name="label" :option="optValue(o)">
          {{ optLabel(o) }}
        </slot>
      </button>
      <span v-if="!options.length && emptyMessage" class="np-empty">{{ emptyMessage }}</span>
    </div>
  </section>
</template>
