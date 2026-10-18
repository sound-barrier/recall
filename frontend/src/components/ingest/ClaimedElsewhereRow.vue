<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { ClaimTransfer } from '@/api-client'
import { plainLanguageError } from '@/error-helpers'
import { takeFolderScreenshots } from '@/queries/matches'
import { useWriteGate } from '@/composables/shared/useWriteGate'

// The Parse tab's row for screenshots another profile owns. A screenshot
// belongs to the first profile that parses it; every other profile skips it,
// even on a shared folder. This row says how many the folder holds and offers
// the one deliberate way to move them here: a two-step confirm, because their
// matches leave the profile that has them. Each step unmounts the button that
// was clicked, so focus is handed on explicitly rather than dropped.
// "Move" is the app's word for sending matches between profiles (the Matches
// bulk Move to…), so the arm, confirm and result all say it.

const props = defineProps<{
  // Screenshots in the folder another profile owns (the pending count's
  // claimed_elsewhere).
  count: number
}>()

const { writesLocked, lockedTitle, guardWrite } = useWriteGate()
const armed = ref(false)
const busy = ref(false)
const taken = ref<ClaimTransfer | null>(null)
const error = ref<string | null>(null)
const armEl = ref<HTMLButtonElement | null>(null)
const confirmEl = ref<HTMLButtonElement | null>(null)
const resultEl = ref<HTMLParagraphElement | null>(null)

const summary = computed(() =>
  props.count === 1
    ? '1 screenshot in this folder belongs to another profile, which parsed it first.'
    : `${props.count} screenshots in this folder belong to other profiles, which parsed them first.`,
)

const takenLine = computed(() => {
  const t = taken.value
  if (!t) return ''
  const shots = `${t.screenshots} screenshot${t.screenshots === 1 ? '' : 's'}`
  if (t.matches_moved === 0) return `Moved ${shots} here. Run Parse to read ${t.screenshots === 1 ? 'it' : 'them'}.`
  return `Moved ${shots} and ${t.matches_moved} match${t.matches_moved === 1 ? '' : 'es'} here.`
})

function arm() {
  error.value = null
  taken.value = null
  armed.value = true
  void nextTick(() => confirmEl.value?.focus())
}

function disarm() {
  armed.value = false
  void nextTick(() => armEl.value?.focus())
}

async function confirm() {
  if (!guardWrite() || busy.value) return
  busy.value = true
  try {
    taken.value = await takeFolderScreenshots()
    armed.value = false
    void nextTick(() => resultEl.value?.focus())
  } catch (e) {
    error.value = plainLanguageError(String(e))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="count > 0 || taken" class="setting-row" :class="{ 'danger-row': armed }">
    <div class="setting-info">
      <h4 class="setting-label">
        Other profiles' screenshots
      </h4>
      <p v-if="count > 0" class="setting-desc">
        {{ summary }} This profile skips them unless you move them here.
      </p>
      <p v-if="armed" class="setting-meta">
        Matches built from them leave the other profiles and move here too.
      </p>
      <p v-if="taken" ref="resultEl" class="setting-meta success claimed-result" role="status" tabindex="-1">
        {{ takenLine }}
      </p>
      <p v-if="error" class="setting-meta blocked" role="alert">
        {{ error }}
      </p>
    </div>
    <div v-if="count > 0" class="setting-control">
      <button
        v-if="!armed"
        ref="armEl"
        type="button"
        class="btn"
        :disabled="writesLocked"
        :title="lockedTitle('Move these screenshots and their matches to this profile')"
        @click="arm"
      >
        Move them here…
      </button>
      <div v-else class="clear-confirm-group">
        <button
          ref="confirmEl"
          type="button"
          class="btn danger"
          :disabled="busy || writesLocked"
          :title="lockedTitle('Move these screenshots and their matches to this profile')"
          @click="confirm"
        >
          {{ busy ? 'Moving…' : 'Confirm move' }}
        </button>
        <button type="button" class="btn ghost" :disabled="busy" @click="disarm">
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Focus lands here only to keep the reader's place once the buttons are
   gone; it is not a control, so it draws no ring (as with #main-content). */
.claimed-result:focus {
  outline: none;
}
</style>
