<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { GetCoachingSettings, SetCoachingSettings } from '@/api-client'
import { useAppStore } from '@/stores/app'

// Section 08 — the two identities coaching needs, one per direction.
//
// Server settings rather than browser preferences: the exported ledger is
// rendered server-side and needs the coach name, and the player handle is
// stamped into a shared bundle's manifest. Both commit on blur / Enter, like
// the replay-code field.
//
// The handle is here because it was set only as a side effect of sharing and
// shown nowhere, so the share dialog asked for it again every single time —
// on a value the server had all along.
const appStore = useAppStore()

const coachName = ref('')
const playerHandle = ref('')
const saved = ref({ coach_name: '', player_handle: '' })
const busy = ref(false)

function reset() {
  coachName.value = saved.value.coach_name
  playerHandle.value = saved.value.player_handle
}

onMounted(async () => {
  try {
    saved.value = await GetCoachingSettings()
    reset()
  } catch (e) {
    appStore.setErrorFromRaw(String(e))
  }
})

// One writer for both fields: the PUT carries both, because an omitted
// string is indistinguishable from an empty one and "leave this alone" would
// read as "clear this".
async function commit() {
  const next = { coach_name: coachName.value.trim(), player_handle: playerHandle.value.trim() }
  coachName.value = next.coach_name
  playerHandle.value = next.player_handle
  const unchanged = next.coach_name === saved.value.coach_name
    && next.player_handle === saved.value.player_handle
  if (busy.value || unchanged) return
  busy.value = true
  try {
    saved.value = await SetCoachingSettings(next)
  } catch (e) {
    appStore.setErrorFromRaw(String(e))
  } finally {
    // Either the server's copy or the last known good one — never the
    // rejected draft, which would look saved.
    reset()
    busy.value = false
  }
}
</script>

<template>
  <div id="sec-coaching" class="settings-section">
    <div class="section-header">
      <span class="section-num">08</span>
      <span class="section-slash" aria-hidden="true">/</span>
      <h3 class="section-title">
        Coaching
      </h3>
    </div>
    <div class="setting-rows">
      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            <label for="coach-name-input">Your coach name</label>
          </h4>
          <p class="setting-desc">
            Signs the notes you write while reviewing another player's bundle, and
            names you on the notes file they get back. Notes can't be exported
            until it is set.
          </p>
        </div>
        <div class="setting-control">
          <input
            id="coach-name-input"
            v-model="coachName"
            class="coach-name-input"
            type="text"
            maxlength="60"
            autocomplete="off"
            spellcheck="false"
            placeholder="e.g. Ordo"
            @blur="commit"
            @keydown.enter.prevent="commit"
          >
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            <label for="player-handle-input">Your player handle</label>
          </h4>
          <p class="setting-desc">
            The name your coach sees when you send matches to them. Filled in
            for you from the last time you shared, so the share dialog stops
            asking.
          </p>
        </div>
        <div class="setting-control">
          <input
            id="player-handle-input"
            v-model="playerHandle"
            class="coach-name-input"
            type="text"
            maxlength="60"
            autocomplete="off"
            spellcheck="false"
            placeholder="e.g. Sable"
            @blur="commit"
            @keydown.enter.prevent="commit"
          >
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.coach-name-input {
  min-width: 12rem;
  padding: 0.45rem 0.6rem;
  font-family: var(--body);
  font-size: var(--type-lg);
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.coach-name-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}
</style>
