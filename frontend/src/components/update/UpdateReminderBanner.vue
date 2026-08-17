<script setup lang="ts">
// "You haven't checked for updates in 90 days" reminder banner. Lives
// between the masthead and main content. Dismissible — the user can
// snooze for the rest of the current 90-day window, and a successful
// "Check now" click resets the timer + closes the banner.
//
// Modeled on DashboardEditBanner.vue (accent stripe + condensed
// type + slide enter/leave + reduced-motion collapse). role="status"
// + aria-live="polite" so SR users hear the new state without an
// interrupt.
//
// Owns the whole reminder feature: useUpdateReminder derives the gate +
// day-count from the app store's updateInfo, and "Check now" opens About (the
// update hub), which runs the check and resets the cycle.
import { storeToRefs } from 'pinia'
import { useAppStore } from '@/stores/app'
import { useUpdateReminder } from '@/composables/update/useUpdateReminder'

const appStore = useAppStore()
const { updateInfo } = storeToRefs(appStore)
const { openAbout } = appStore
const { shouldShowBanner, daysSinceLastCheck, dismiss } = useUpdateReminder(updateInfo)
</script>

<template>
  <Transition name="update-reminder-banner">
    <div v-if="shouldShowBanner" class="update-reminder-banner" role="status" aria-live="polite">
      <span class="update-reminder-banner-pulse" aria-hidden="true" />
      <div class="update-reminder-banner-copy">
        <span class="update-reminder-banner-label">Update check overdue</span>
        <span class="update-reminder-banner-help">
          <template v-if="daysSinceLastCheck !== null">
            Last checked {{ daysSinceLastCheck }} days ago. Roster + screenshot-format updates may exist.
          </template>
          <template v-else>
            You haven't checked for updates yet. Roster + screenshot-format updates may exist.
          </template>
        </span>
      </div>
      <button
        type="button"
        class="update-reminder-banner-check"
        data-update-reminder-check
        @click="openAbout"
      >
        Check now
      </button>
      <button
        type="button"
        class="update-reminder-banner-dismiss"
        aria-label="Dismiss update reminder"
        data-update-reminder-dismiss
        @click="dismiss"
      >
        ×
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.update-reminder-banner {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.45rem 0.9rem;
  margin: 0.5rem 0 0.7rem;
  border: 1px solid color-mix(in srgb, var(--accent) 60%, transparent);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
  background:
    linear-gradient(90deg,
      color-mix(in srgb, var(--accent) 12%, transparent) 0%,
      color-mix(in srgb, var(--accent) 5%, transparent) 60%,
      transparent 100%);
  font-family: var(--mono);
  font-size: var(--type-sm);
  letter-spacing: 0.1em;
  color: var(--text);
}

.update-reminder-banner-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  flex: 0 0 auto;
  animation: update-reminder-banner-pulse 1.8s ease-in-out infinite;
}

@keyframes update-reminder-banner-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 70%, transparent); }
  50%      { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 0%, transparent); }
}

.update-reminder-banner-copy {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1 1 auto;
  min-width: 0;
}

.update-reminder-banner-label {
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--accent-text);
}

.update-reminder-banner-help {
  font-size: var(--type-xs);
  letter-spacing: 0.04em;
  text-transform: none;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.update-reminder-banner-check {
  appearance: none;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--surface);
  font-family: var(--mono);
  font-weight: 700;
  font-size: var(--type-2xs);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.34rem 0.7rem;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--duration-fast) ease, color var(--duration-fast) ease;
  flex: 0 0 auto;
}

.update-reminder-banner-check:hover {
  background: color-mix(in srgb, var(--accent) 80%, var(--text));
  color: var(--surface);
}

.update-reminder-banner-check:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

.update-reminder-banner-dismiss {
  appearance: none;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: transparent;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: var(--type-lg);
  line-height: 1;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: var(--radius);
  cursor: pointer;
  flex: 0 0 auto;
  transition: color var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

.update-reminder-banner-dismiss:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.update-reminder-banner-dismiss:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

.update-reminder-banner-enter-active,
.update-reminder-banner-leave-active {
  transition: opacity var(--duration-med) ease,
              transform var(--duration-med) cubic-bezier(0.2, 0.7, 0.3, 1),
              margin var(--duration-med) cubic-bezier(0.2, 0.7, 0.3, 1);
  overflow: hidden;
}

.update-reminder-banner-enter-from,
.update-reminder-banner-leave-to {
  opacity: 0;
  transform: translateY(-6px);
  margin-top: 0;
  margin-bottom: 0;
}

@media (prefers-reduced-motion: reduce) {
  .update-reminder-banner-pulse { animation: none; }

  .update-reminder-banner-enter-active,
  .update-reminder-banner-leave-active { transition: none; }
}

@media (width <= 720px) {
  .update-reminder-banner-help { display: none; }
}
</style>
