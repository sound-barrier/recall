<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { GetProfiles, DeleteProfile } from '@/api'

// Profiles management panel of the Settings view. Lists every profile
// on disk; non-active rows expose a two-step delete affordance that
// wipes the profile directory (DB + settings.json + screenshots dir
// reference). The active profile has no delete button — callers must
// switch profiles first via the masthead chip.

const profiles = ref<string[]>([])
const active   = ref('')
const busy     = ref(false)
const error    = ref<string | null>(null)

// Which row (if any) is in two-step confirm mode. Null = nothing
// armed; setting it to a profile name reveals Confirm + Cancel for
// that row and hides the default Delete button.
const confirmTarget = ref<string | null>(null)

const sortedProfiles = computed(() =>
  [...profiles.value].sort((a, b) => a.localeCompare(b)),
)

async function refresh() {
  try {
    const res = await GetProfiles()
    profiles.value = res.profiles
    active.value   = res.active
  } catch (e) {
    error.value = String(e)
  }
}

function armDelete(name: string) {
  if (busy.value) return
  confirmTarget.value = name
  error.value = null
}

function cancelDelete() {
  confirmTarget.value = null
}

async function confirmDelete(name: string) {
  if (busy.value) return
  busy.value = true
  try {
    await DeleteProfile(name)
    confirmTarget.value = null
    await refresh()
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <div id="sec-profiles" class="settings-section">
    <div class="section-header">
      <span class="section-num">05</span>
      <span class="section-slash" aria-hidden="true">/</span>
      <h3 class="section-title">
        Profiles
      </h3>
    </div>
    <div class="setting-rows">
      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            Manage profiles
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About profile deletion</span>
              <span class="setting-help-pop" role="tooltip">
                Deleting a profile wipes its database, settings, and every screenshot reference for that account. There is no undo. To move matches to a different account, use the masthead profile chip + the Matches "Move to…" picker before deleting.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Switch profiles from the masthead chip. Use this list to permanently delete a profile you no longer need — its database and settings are wiped from disk. The active profile cannot be deleted.
          </p>
        </div>
        <div class="setting-control profile-mgmt-list">
          <ul class="profile-mgmt-rows" role="list">
            <li
              v-for="p in sortedProfiles"
              :key="p"
              class="profile-mgmt-row"
              :class="{ active: p === active }"
              :data-profile="p"
            >
              <span class="profile-mgmt-name">{{ p }}</span>
              <span v-if="p === active" class="profile-mgmt-active-tag">Active</span>
              <template v-else>
                <button
                  v-if="confirmTarget !== p"
                  type="button"
                  class="profile-mgmt-delete"
                  :disabled="busy"
                  :aria-label="`Delete profile ${p}`"
                  @click="armDelete(p)"
                >
                  Delete
                </button>
                <template v-else>
                  <button
                    type="button"
                    class="profile-mgmt-delete-confirm"
                    :disabled="busy"
                    :title="`Permanently delete ${p}`"
                    @click="confirmDelete(p)"
                  >
                    {{ busy ? '…' : 'Confirm delete' }}
                  </button>
                  <button
                    type="button"
                    class="profile-mgmt-delete-cancel"
                    :disabled="busy"
                    @click="cancelDelete"
                  >
                    Cancel
                  </button>
                </template>
              </template>
            </li>
          </ul>
          <p v-if="error" class="profile-mgmt-error">
            {{ error }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-mgmt-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  max-width: 28rem;
}

.profile-mgmt-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-mgmt-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.75rem;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.8rem;
}

.profile-mgmt-row.active {
  border-color: var(--accent-soft);
  background: color-mix(in srgb, var(--accent) 5%, var(--surface-2));
}

.profile-mgmt-name {
  flex: 1 1 auto;
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: 1rem;
  letter-spacing: 0.04em;
  color: var(--text);
  word-break: break-all;
}

.profile-mgmt-active-tag {
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;

  /* Token used by `.bulk-action-bar` for the same chip role — passes
     WCAG AA against the OW Dark / Day / Night / HC surfaces. */
  color: var(--text);
  background: transparent;
  border: 1px solid var(--accent);
  padding: 0.2rem 0.45rem;
  border-radius: 2px;
}

.profile-mgmt-delete,
.profile-mgmt-delete-confirm,
.profile-mgmt-delete-cancel {
  appearance: none;
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 0.35rem 0.7rem;
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}

.profile-mgmt-delete {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-faint);
}

.profile-mgmt-delete:hover:not(:disabled) {
  color: var(--loss, #e74c3c);
  border-color: var(--loss, #e74c3c);
}

.profile-mgmt-delete-confirm {
  background: var(--loss, #e74c3c);
  border: 1px solid var(--loss, #e74c3c);
  color: var(--bg, #fff);
}

.profile-mgmt-delete-cancel {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
}

.profile-mgmt-error {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--loss, #e74c3c);
}
</style>
