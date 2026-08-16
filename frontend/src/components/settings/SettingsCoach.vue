<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { GetCoachName, SetCoachName } from '@/api-client'
import { useAppStore } from '@/stores/app'

// Section 08 — the name this user signs coaching notes with.
//
// A server setting rather than a browser preference: the exported ledger is
// rendered server-side and needs the name, and Export stays disabled until
// one is set. Commits on blur / Enter, like the replay-code field.
const appStore = useAppStore()

const coachName = ref('')
const saved = ref('')
const busy = ref(false)

onMounted(async () => {
  try {
    const name = await GetCoachName()
    coachName.value = name
    saved.value = name
  } catch (e) {
    appStore.setErrorFromRaw(String(e))
  }
})

async function commit() {
  const next = coachName.value.trim()
  coachName.value = next
  if (busy.value || next === saved.value) return
  busy.value = true
  try {
    saved.value = await SetCoachName(next)
    coachName.value = saved.value
  } catch (e) {
    coachName.value = saved.value
    appStore.setErrorFromRaw(String(e))
  } finally {
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
