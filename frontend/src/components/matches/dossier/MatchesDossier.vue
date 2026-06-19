<script setup lang="ts">
import type { MatchRecord } from '@/api'
import type { useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'

// The set-dossier header: the eyebrow + headline + subline and the
// active-clause chip row. The chips mutate the narrow bundle's refs
// directly, so it's destructured to top-level (refs inside a prop
// object don't auto-unwrap). The dossier-actions, widget grid, and the
// teleported popovers stay in MatchesView — they're its control surface.
const props = defineProps<{
  narrow: ReturnType<typeof useMatchesNarrow>
  setHeadline: string
  setSubline: string
  anchorRecord: MatchRecord | null
  anchorChipLabel: string
}>()

const {
  anyNarrow,
  searchText,
  pickedRange,
  customFrom,
  customTo,
  pickedMaps,
  pickedGameModes,
  pickedHeroes,
  pickedRoles,
  pickedResults,
  pickedTags,
  pickedMembers,
  pickedReviewedBy,
  pickedSources,
  leaverHandling,
  minPlayMinutes,
  minPlayPercent,
  includeUnknown,
  sinceAnchorActive,
  pickRange,
  pickMap,
  pickGameMode,
  pickHero,
  pickRole,
  pickResult,
  pickTag,
  pickMember,
  pickReviewedBy,
  pickSource,
  resetNarrow,
} = props.narrow

// Human label for a provenance chip — the picked-set values are the
// raw enum, the chip shows the user-facing wording.
function sourceLabel(source: string): string {
  return source === 'manual' ? 'user entered' : 'edited'
}
</script>

<template>
  <header class="dossier-head">
    <span class="dossier-eyebrow">{{ anyNarrow ? 'Narrowed set' : 'Set' }}</span>
    <h2 class="dossier-title">
      {{ setHeadline }}
    </h2>
    <span class="dossier-meta">{{ setSubline }}</span>

    <ul v-if="anyNarrow" class="active-chips" aria-label="Active narrowing clauses">
      <li v-if="searchText.trim()" class="active-chip search">
        <span class="chip-key">Search</span>
        <span class="chip-val">"{{ searchText.trim() }}"</span>
        <button class="chip-x" aria-label="Clear search" @click="searchText = ''">
          ×
        </button>
      </li>
      <li v-if="pickedRange !== 'all' && !customFrom && !customTo" class="active-chip range">
        <span class="chip-key">Range</span>
        <span class="chip-val">last {{ pickedRange }}</span>
        <button class="chip-x" aria-label="Drop range" @click="pickRange('all')">
          ×
        </button>
      </li>
      <li v-if="customFrom || customTo" class="active-chip range">
        <span class="chip-key">Dates</span>
        <span class="chip-val">{{ customFrom || '…' }} → {{ customTo || '…' }}</span>
        <button class="chip-x" aria-label="Clear dates" @click="customFrom = ''; customTo = ''; pickedRange = 'all'">
          ×
        </button>
      </li>
      <li v-for="m in [...pickedMaps]" :key="`m-${m}`" class="active-chip">
        <span class="chip-key">Map</span>
        <span class="chip-val">{{ m }}</span>
        <button class="chip-x" :aria-label="`Drop map ${m}`" @click="pickMap(m)">
          ×
        </button>
      </li>
      <li v-for="t in [...pickedGameModes]" :key="`mt-${t}`" class="active-chip">
        <span class="chip-key">Type</span>
        <span class="chip-val">{{ t }}</span>
        <button class="chip-x" :aria-label="`Drop type ${t}`" @click="pickGameMode(t)">
          ×
        </button>
      </li>
      <li v-for="h in [...pickedHeroes]" :key="`h-${h}`" class="active-chip">
        <span class="chip-key">Hero</span>
        <span class="chip-val">{{ h }}</span>
        <button class="chip-x" :aria-label="`Drop hero ${h}`" @click="pickHero(h)">
          ×
        </button>
      </li>
      <li v-for="r in [...pickedRoles]" :key="`r-${r}`" class="active-chip">
        <span class="chip-key">Role</span>
        <span class="chip-val">{{ r }}</span>
        <button class="chip-x" :aria-label="`Drop role ${r}`" @click="pickRole(r)">
          ×
        </button>
      </li>
      <li v-for="r in [...pickedResults]" :key="`res-${r}`" class="active-chip">
        <span class="chip-key">Result</span>
        <span class="chip-val">{{ r }}</span>
        <button class="chip-x" :aria-label="`Drop result ${r}`" @click="pickResult(r)">
          ×
        </button>
      </li>
      <li v-for="t in [...pickedTags]" :key="`tg-${t}`" class="active-chip">
        <span class="chip-key">Tag</span>
        <span class="chip-val">#{{ t }}</span>
        <button class="chip-x" :aria-label="`Drop tag ${t}`" @click="pickTag(t)">
          ×
        </button>
      </li>
      <li v-for="m in [...pickedMembers]" :key="`mem-${m}`" class="active-chip member">
        <span class="chip-key">With</span>
        <span class="chip-val">{{ m }}</span>
        <button class="chip-x" :aria-label="`Drop teammate ${m}`" @click="pickMember(m)">
          ×
        </button>
      </li>
      <li v-if="leaverHandling !== 'include'" class="active-chip">
        <span class="chip-key">Leavers</span>
        <span class="chip-val">{{ leaverHandling === 'hide' ? 'hidden' : 'no tally' }}</span>
        <button class="chip-x" aria-label="Reset leavers" @click="leaverHandling = 'include'">
          ×
        </button>
      </li>
      <li v-if="minPlayMinutes > 0" class="active-chip">
        <span class="chip-key">Min play</span>
        <span class="chip-val">≥ {{ minPlayMinutes }}m</span>
        <button class="chip-x" aria-label="Reset min play minutes" @click="minPlayMinutes = 0">
          ×
        </button>
      </li>
      <li v-if="minPlayPercent > 0" class="active-chip">
        <span class="chip-key">Min played</span>
        <span class="chip-val">≥ {{ minPlayPercent }}%</span>
        <button class="chip-x" aria-label="Reset min play percent" @click="minPlayPercent = 0">
          ×
        </button>
      </li>
      <li v-if="includeUnknown" class="active-chip">
        <span class="chip-key">Unknown</span>
        <span class="chip-val">shown</span>
        <button class="chip-x" aria-label="Hide unknown" @click="includeUnknown = false">
          ×
        </button>
      </li>
      <li
        v-for="b in [...pickedReviewedBy]"
        :key="`rb-${b}`"
        class="active-chip"
      >
        <span class="chip-key">Reviewed by</span>
        <span class="chip-val">{{ b }}</span>
        <button class="chip-x" :aria-label="`Drop ${b}`" @click="pickReviewedBy(b)">
          ×
        </button>
      </li>
      <li
        v-for="s in [...pickedSources]"
        :key="`src-${s}`"
        class="active-chip"
        :data-source-chip="s"
      >
        <span class="chip-key">Provenance</span>
        <span class="chip-val">{{ sourceLabel(s) }}</span>
        <button class="chip-x" :aria-label="`Drop ${sourceLabel(s)}`" @click="pickSource(s)">
          ×
        </button>
      </li>
      <li v-if="sinceAnchorActive && anchorRecord" class="active-chip">
        <span class="chip-key">Since</span>
        <span class="chip-val">{{ anchorChipLabel }}</span>
        <button
          class="chip-x"
          aria-label="Stop filtering since anchor"
          @click="sinceAnchorActive = false"
        >
          ×
        </button>
      </li>
      <li class="active-chip clear">
        <button class="chip-clear" @click="resetNarrow">
          Clear all
        </button>
      </li>
    </ul>
    <!-- Reserve the chip row's height when no filter is active so selecting a
         date (which makes the chip row appear) never resizes the dossier. -->
    <div v-else class="active-chips-reserve" aria-hidden="true" />
  </header>
</template>

<style scoped>
.dossier-head { display: flex; flex-direction: column; gap: 0.2rem; }

.dossier-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.dossier-title {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 1.7rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  margin: 0;
  color: var(--text);
  line-height: 1.1;
}

.dossier-meta {
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-dim);
}

.active-chips {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

/* The chip row and its empty-state reserve share one min-height so the dossier
   stays the same height whether or not a date/narrow filter is active. */
.active-chips,
.active-chips-reserve {
  min-height: 1.5rem;
}

.active-chips-reserve {
  margin: 0.4rem 0 0;
}

.active-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.18rem 0.18rem 0.5rem;
  background: var(--surface-2);
  border: 1px solid var(--accent-soft, var(--accent));
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text);
}

.active-chip.range, .active-chip.search { border-color: var(--accent); }

.chip-key {
  color: var(--text-faint);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 0.55rem;
}

.chip-val {
  color: var(--text);
  font-weight: 600;
  text-transform: lowercase;
}

.chip-x {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--text-faint);
  padding: 0 0.3rem;
  font-size: 0.85rem;
  cursor: pointer;
  line-height: 1;
}
.chip-x:hover { color: var(--accent); }

.active-chip.clear {
  border: 1px dashed var(--text-faint);
  padding: 0;
}

.chip-clear {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0.18rem 0.55rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
  font-weight: 700;
}
.chip-clear:hover { color: var(--accent); }
</style>
