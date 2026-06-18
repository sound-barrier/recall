<script setup lang="ts">
// Boot-failure modal — shown when GetStartupError() returns a non-empty
// message. Display-only: App owns the open state + the focus trap; this
// just renders the same markup it used to hold inline.
defineProps<{ open: boolean; message: string }>()
</script>

<template>
  <transition name="modal-fade">
    <div
      v-if="open"
      class="modal-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="startup-error-title"
      aria-describedby="startup-error-message"
      data-testid="startup-error-modal"
    >
      <div class="modal-box startup-error">
        <div class="modal-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28">
            <path d="M12 2.6 L22.4 20.5 L1.6 20.5 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
            <line x1="12" y1="10" x2="12" y2="15.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            <circle cx="12" cy="17.8" r="1.2" fill="currentColor" />
          </svg>
        </div>
        <h3 id="startup-error-title" class="modal-title">
          Recall could not start
        </h3>
        <p id="startup-error-message" class="modal-body">
          {{ message }}
        </p>
        <p class="modal-body modal-caution">
          Recall captured a failure during boot — restart the app to try again. If the problem persists, check the application data directory for permissions issues and file a report from the Settings tab once you can re-enter the app.
        </p>
      </div>
    </div>
  </transition>
</template>
