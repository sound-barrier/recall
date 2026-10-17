<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ClaimTransfer } from '@/api-client'
import { plainLanguageError } from '@/error-helpers'
import { takeFolderScreenshots } from '@/queries/matches'
import { useWriteGate } from '@/composables/shared/useWriteGate'

// The Parse tab's row for screenshots another profile owns. A screenshot
// belongs to the first profile that parses it; every other profile skips it,
// even on a shared folder. This row says how many the folder holds and offers
// the one deliberate way to take them: a two-step confirm, because their
// matches leave the profile that has them.

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

const summary = computed(() =>
  props.count === 1
    ? '1 screenshot in this folder belongs to another profile, which parsed it first.'
    : `${props.count} screenshots in this folder belong to other profiles, which parsed them first.`,
)

const takenLine = computed(() => {
  const t = taken.value
  if (!t) return ''
  const shots = `Took ${t.screenshots} screenshot${t.screenshots === 1 ? '' : 's'}`
  if (t.matches_moved === 0) return `${shots}. Run Parse to read ${t.screenshots === 1 ? 'it' : 'them'}.`
  return `${shots} · ${t.matches_moved} match${t.matches_moved === 1 ? '' : 'es'} moved here.`
})

function arm() {
  error.value = null
  taken.value = null
  armed.value = true
}

async function confirm() {
  if (!guardWrite() || busy.value) return
  busy.value = true
  try {
    taken.value = await takeFolderScreenshots()
    armed.value = false
  } catch (e) {
    error.value = plainLanguageError(String(e))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="count > 0 || taken" class="setting-row">
    <div class="setting-info">
      <h4 class="setting-label">
        Other profiles' screenshots
      </h4>
      <p v-if="count > 0" class="setting-desc">
        {{ summary }} This profile skips them unless you take them.
      </p>
      <p v-if="armed" class="setting-meta">
        Their matches move to this profile and leave the others.
      </p>
      <p v-if="taken" class="setting-meta" role="status">
        {{ takenLine }}
      </p>
      <p v-if="error" class="setting-meta blocked" role="alert">
        {{ error }}
      </p>
    </div>
    <div v-if="count > 0" class="setting-control cluster gap-2">
      <button
        v-if="!armed"
        type="button"
        class="btn"
        :disabled="writesLocked"
        :title="lockedTitle('Move these screenshots and their matches to this profile')"
        @click="arm"
      >
        Take them
      </button>
      <template v-else>
        <button
          type="button"
          class="btn danger"
          :disabled="busy || writesLocked"
          :title="lockedTitle('Move these screenshots and their matches to this profile')"
          @click="confirm"
        >
          {{ busy ? 'Moving…' : 'Move them here' }}
        </button>
        <button type="button" class="btn ghost" :disabled="busy" @click="armed = false">
          Cancel
        </button>
      </template>
    </div>
  </div>
</template>
