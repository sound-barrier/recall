<script setup lang="ts">
// Full-width "OCR engine offline" halt banner, rendered above the masthead
// on a broken install. App gates it on !tesseractReady and owns the
// deep-link to Settings → Engine.
defineProps<{ path: string; error: string }>()
const emit = defineEmits<{ fix: [] }>()
</script>

<template>
  <div class="system-alert" role="alert">
    <div class="system-alert-stripes" aria-hidden="true" />
    <div class="system-alert-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="26" height="26">
        <path d="M12 2.6 L22.4 20.5 L1.6 20.5 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
        <line x1="12" y1="10" x2="12" y2="15.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        <circle cx="12" cy="17.8" r="1.2" fill="currentColor" />
      </svg>
    </div>
    <div class="system-alert-body">
      <div class="system-alert-eyebrow">
        System Halt · OCR Engine Offline
      </div>
      <h3 class="system-alert-title">
        Tesseract not detected
        <span class="system-alert-path" :title="path">{{ path || '— no path —' }}</span>
      </h3>
      <p class="system-alert-desc">
        {{ error || 'Recall cannot OCR screenshots without Tesseract. Install it, or point Recall at the existing binary in Settings → Engine.' }}
      </p>
    </div>
    <div class="system-alert-actions">
      <button class="btn alert-cta" @click="emit('fix')">
        <span class="alert-cta-arrow" aria-hidden="true">→</span>
        Fix in Settings → Engine
      </button>
    </div>
  </div>
</template>
