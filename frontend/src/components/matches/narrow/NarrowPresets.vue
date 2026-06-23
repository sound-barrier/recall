<script setup lang="ts">
import { ref } from 'vue'
import type { useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'
import { useNarrowPresets } from '@/composables/matches/useNarrowPresets'

// "Saved sets" — typed snapshots of the narrow state persisted in
// localStorage: name + Save + the recallable list (click to apply, × to
// delete). Extracted from NarrowPopover so the filter panel sheds this
// self-contained feature. Takes the narrow bundle and drives
// useNarrowPresets against it.
const props = defineProps<{
  narrow: ReturnType<typeof useMatchesNarrow>
}>()

const { presets, savePreset, applyPreset, deletePreset } = useNarrowPresets(props.narrow)
const newPresetName = ref('')

function onSavePreset() {
  const name = newPresetName.value.trim()
  if (!name) return
  savePreset(name)
  newPresetName.value = ''
}
</script>

<template>
  <section class="np-presets" aria-label="Saved sets">
    <header class="np-presets-head">
      <span class="np-presets-eyebrow">Saved sets</span>
    </header>
    <div class="np-presets-save">
      <input
        v-model="newPresetName"
        type="text"
        class="np-presets-input"
        placeholder="Save current narrow as…"
        aria-label="Preset name"
        data-presets-save-input
        @keydown.enter.prevent="onSavePreset"
      >
      <button
        class="np-btn ghost"
        :disabled="!newPresetName.trim()"
        data-presets-save-btn
        @click="onSavePreset"
      >
        Save
      </button>
    </div>
    <ul v-if="presets.length > 0" class="np-presets-list">
      <li v-for="p in presets" :key="p.name" class="np-preset">
        <button
          class="np-preset-apply"
          :data-preset-name="p.name"
          @click="applyPreset(p.name)"
        >
          {{ p.name }}
        </button>
        <button
          class="np-preset-delete"
          :aria-label="`Delete preset ${p.name}`"
          @click="deletePreset(p.name)"
        >
          ×
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.np-presets {
  margin: 1rem -0.25rem 0.4rem;
  padding: 0.6rem 0.6rem 0.7rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 3px;
}

.np-presets-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}

.np-presets-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.np-presets-save {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.np-presets-input {
  flex: 1;
  appearance: none;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.32rem 0.5rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text);
  outline: 0;
}

.np-presets-input:focus { border-color: var(--accent); }

.np-presets-list {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.np-preset {
  display: inline-flex;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
}

.np-preset-apply {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0.25rem 0.55rem;
  font-family: var(--mono);
  font-size: 0.66rem;
  letter-spacing: 0.06em;
  color: var(--text);
  cursor: pointer;
}

.np-preset-apply:hover,
.np-preset-apply:focus-visible {
  color: var(--accent);
  outline: none;
}

.np-preset-delete {
  appearance: none;
  background: transparent;
  border: 0;
  border-left: 1px solid var(--border);
  padding: 0.25rem 0.5rem;
  font-family: var(--mono);
  font-size: 0.85rem;
  line-height: 1;
  color: var(--text-faint);
  cursor: pointer;
}

.np-preset-delete:hover,
.np-preset-delete:focus-visible {
  color: var(--loss);
  outline: none;
}

</style>
