<script setup lang="ts">
import { computed } from 'vue'
import type { MatchRecord } from '@/api-client'

// Small provenance chip shown on match cards + the detail-panel header.
// Three states: OCR (parsed from screenshots), Edited (parsed then
// user-corrected), Manual (hand-entered). `compact` renders the icon only
// (dense rows); the full form adds the text label.
const props = withDefaults(
  defineProps<{
    source?: MatchRecord['source']
    editedFields?: string[]
    compact?: boolean
  }>(),
  { source: 'ocr', editedFields: () => [], compact: false },
)

type Variant = 'ocr' | 'ocr_edited' | 'manual'

const variant = computed<Variant>(() =>
  props.source === 'manual' || props.source === 'ocr_edited' ? props.source : 'ocr',
)

// Kebab class (stylelint rejects the enum's `ocr_edited` underscore).
const badgeClass = computed(() =>
  variant.value === 'ocr_edited' ? 'prov-edited' : `prov-${variant.value}`,
)

const label = computed(() =>
  variant.value === 'manual' ? 'User entered' : variant.value === 'ocr_edited' ? 'Edited' : 'OCR',
)

const tip = computed(() => {
  if (variant.value === 'manual') return 'Hand-entered match (no screenshots).'
  if (variant.value === 'ocr_edited') {
    const n = props.editedFields?.length ?? 0
    const fields = n === 1 ? '1 field' : `${n} fields`
    return `Parsed from screenshots, then edited (${fields}).`
  }
  return 'Parsed from screenshots.'
})
</script>

<template>
  <span
    class="prov-badge"
    :class="[badgeClass, { 'prov-compact': compact }]"
    role="img"
    :title="tip"
    :aria-label="`Source: ${label}. ${tip}`"
  >
    <svg class="prov-ico" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <!-- Viewfinder frame + scanline = machine-read (OCR / Edited). -->
      <g v-if="variant !== 'manual'" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 5.5V3.5A1.5 1.5 0 0 1 3.5 2H5.5" />
        <path d="M10.5 2H12.5A1.5 1.5 0 0 1 14 3.5V5.5" />
        <path d="M14 10.5V12.5A1.5 1.5 0 0 1 12.5 14H10.5" />
        <path d="M5.5 14H3.5A1.5 1.5 0 0 1 2 12.5V10.5" />
        <path v-if="variant === 'ocr'" d="M4.8 8H11.2" />
      </g>
      <!-- Pencil = a human touched it (Edited overlay + Manual). -->
      <g v-if="variant !== 'ocr'" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 11L10.5 5.5L12 7L6.5 12.5H5Z" />
        <path d="M9.5 6.5L11 8" />
      </g>
    </svg>
    <span v-if="!compact" class="prov-label">{{ label }}</span>
  </span>
</template>

<style scoped>
.prov-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.12rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  line-height: 1;
  white-space: nowrap;
}

.prov-compact {
  padding: 0.16rem;
  gap: 0;
}

.prov-ico {
  width: 0.82rem;
  height: 0.82rem;
  flex: none;
  display: block;
}

/* OCR — the unremarkable default: muted, sits quietly in the row. */
.prov-ocr {
  color: var(--text-faint);
}

/* Edited — the user touched a parsed match: accent outline draws the eye. */
.prov-edited {
  color: var(--accent);
  border-color: var(--accent-soft);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
}

/* Manual — hand-entered: a filled accent wash distinguishes it from Edited
   at a glance even before the label registers. */
.prov-manual {
  color: var(--accent);
  border-color: var(--accent-soft);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
}
</style>
