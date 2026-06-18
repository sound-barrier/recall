<script setup lang="ts">
// Unsupported-Tesseract-version confirmation. App owns the open state +
// the focus trap; this renders the markup and emits cancel / confirm.
defineProps<{ open: boolean; version: string }>()
const emit = defineEmits<{ cancel: []; confirm: [] }>()
</script>

<template>
  <transition name="modal-fade">
    <div v-if="open" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title" @click.self="emit('cancel')">
      <div class="modal-box">
        <div class="modal-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28">
            <path d="M12 2.6 L22.4 20.5 L1.6 20.5 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
            <line x1="12" y1="10" x2="12" y2="15.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            <circle cx="12" cy="17.8" r="1.2" fill="currentColor" />
          </svg>
        </div>
        <h3 id="modal-title" class="modal-title">
          Unsupported Tesseract Version
        </h3>
        <p class="modal-body">
          Tesseract <strong>{{ version }}</strong> is detected. Only version <strong>5.x</strong> is officially tested with Recall.
        </p>
        <p class="modal-body modal-caution">
          Proceed at your own caution — OCR results may be incorrect or incomplete with this version.
        </p>
        <div class="modal-actions">
          <button class="btn ghost" @click="emit('cancel')">
            Cancel
          </button>
          <button class="btn primary" @click="emit('confirm')">
            Continue Anyway
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>
