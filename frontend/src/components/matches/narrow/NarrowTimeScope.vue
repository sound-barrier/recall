<script setup lang="ts">
import { nextTick, ref } from 'vue'

import type { useMatchesNarrow } from '@/composables/matches/narrow/useMatchesNarrow'
import { formatRangeBound } from '@/match/match-time-helpers'
import { parseDatePhrase, SUPPORTED_PHRASES } from '@/match/match-date-phrase'
import { useOWData } from '@/composables/shared/useOWData'
import { useWeekStart } from '@/composables/shared/useWeekStart'

// The Time-scope facet: preset range chips (All / 7d / 30d / 90d) + a custom
// from/to date pair, each with an OPTIONAL minute bound (blank = whole day —
// the patch-drop primitive: "from Jan 7 11:00" splits a day at the patch).
// Reads + writes pickedRange / customFrom / customTo (+ the panel-owned
// customFromTime / customToTime) off the shared narrow bundle — picking a
// preset resolves it to a concrete from-bound and drops the to-bound and both
// minute bounds; editing either date flips pickedRange to 'custom', and
// emptying the last date returns it to 'all'; emptying a date clears its time
// (a time without a date is inert, so the input is disabled until its date is
// set).
// np-section / np-chip chrome is global (narrow.css); the date/time inputs
// carry their own scoped styles.
type MatchesNarrowApi = ReturnType<typeof useMatchesNarrow>
const props = defineProps<{ narrow: MatchesNarrowApi }>()
const { pickedRange, customFrom, customTo, customFromTime, customToTime, pickRange, pickedSeason } = props.narrow

// Season options come from reference data (seasons.yaml), grouped by chapter
// for the <optgroup>s. A season assigns a match by its START time and ANDs
// with the date range, so it sits above the preset chips as the coarsest scope.
// '' = "Any season" (the empty option), which clears the filter.
const { seasonsByChapter, seasons } = useOWData()
const { weekStart } = useWeekStart()

function onSeasonChange(e: Event) {
  pickedSeason.value = (e.target as HTMLSelectElement).value
}

function onDateInput(side: 'from' | 'to', value: string) {
  const dateRef = side === 'from' ? customFrom : customTo
  const timeRef = side === 'from' ? customFromTime : customToTime
  dateRef.value = value
  if (!value) timeRef.value = ''
  // Emptying the LAST remaining bound is "no custom range" — the same state
  // the Clear-dates button produces. Staying on 'custom' with nothing set
  // left a clause that counted and blocked Reset while filtering nothing.
  pickedRange.value = customFrom.value || customTo.value ? 'custom' : 'all'
}

function onTimeInput(side: 'from' | 'to', value: string) {
  const timeRef = side === 'from' ? customFromTime : customToTime
  timeRef.value = value
  pickedRange.value = 'custom'
}

// A typed phrase ("last week", "since Friday", "this season") resolved against
// the SAME state the chips and pickers write, so there is one filter and three
// ways to reach it.
//
// It DECLINES loudly rather than guessing. A date filter that quietly picks the
// wrong window is worse than one that does nothing: the user sees a filtered
// set, believes it means what they asked for, and reads conclusions off it. On
// a decline the existing filter is left exactly as it was — a refusal must
// never clear what the user already set.
const phrase = ref('')
const phraseError = ref('')
// Cleared, THEN set on the next tick — the clear is what makes an identical
// refusal re-announce, and setting second means the region keeps the message
// afterwards rather than emptying itself. See the region in the template for
// why it is separate from the visible paragraph.
const phraseAnnouncement = ref('')
function announce(message: string) {
  phraseAnnouncement.value = ''
  void nextTick(() => { phraseAnnouncement.value = message })
}

function applyPhrase() {
  const parsed = parseDatePhrase(phrase.value, {
    now: new Date(),
    weekStartsOn: weekStart.value,
    seasons: seasons.value,
  })
  if (!parsed) {
    phraseError.value = phrase.value.trim()
      ? `Not sure what "${phrase.value.trim()}" means — try ${SUPPORTED_PHRASES.join(', ')}.`
      : ''
    announce(phraseError.value)
    return
  }
  phraseError.value = ''
  // Success announces too. Silence after a refusal would leave the region
  // still reading "Not sure what…" to anyone who came back to it, and the
  // window that got applied is worth stating anyway — the phrase field clears
  // itself on success, so otherwise nothing says what happened.
  announce(`Filtered to ${parsed.label}.`)
  // A phrase names ONE window, so each branch clears the other's state. Without
  // that, "last week" followed by "this season" leaves both set and the clauses
  // AND them — the user described one window and got the intersection of two.
  // The preset chips already reset the custom bounds for exactly this reason
  // (pickRange); this is the same rule for the third way in.
  clearDates()
  pickedSeason.value = ''
  if (parsed.kind === 'season') {
    // Written directly, NOT through pickSeason — that toggles, so applying the
    // same phrase twice would set the filter and then clear it.
    pickedSeason.value = parsed.name
  } else {
    customFrom.value = parsed.from
    customTo.value = parsed.to
    pickedRange.value = 'custom'
  }
  phrase.value = ''
}

function clearDates() {
  customFrom.value = ''
  customTo.value = ''
  customFromTime.value = ''
  customToTime.value = ''
  pickedRange.value = 'all'
}
</script>

<template>
  <!-- Time scope — preset + custom dates side-by-side. -->
  <section class="np-section">
    <div class="np-section-head">
      <span class="eyebrow np-section-eyebrow">Time scope</span>
      <span class="np-section-meta">
        <template v-if="customFrom || customTo">{{ formatRangeBound(customFrom, customFromTime) }} → {{ formatRangeBound(customTo, customToTime) }}</template>
        <template v-else-if="pickedRange !== 'all'">last {{ pickedRange }}</template>
        <template v-else>all time</template>
      </span>
    </div>
    <label v-if="seasonsByChapter.length" class="np-season">
      <span class="np-season-label">Season</span>
      <select
        class="np-date np-season-select"
        data-np-season
        :value="pickedSeason"
        @change="onSeasonChange"
      >
        <option value="">Any season</option>
        <optgroup v-for="group in seasonsByChapter" :key="group.chapter" :label="group.chapter">
          <option v-for="s in group.seasons" :key="s.name" :value="s.name">{{ s.name }}</option>
        </optgroup>
      </select>
    </label>
    <div class="np-chips">
      <button
        v-for="opt in (['all', '7d', '30d', '90d'] as const)"
        :key="opt"
        class="np-chip"
        :class="{ picked: pickedRange === opt }"
        :aria-pressed="pickedRange === opt"
        @click="pickRange(opt)"
      >
        {{ opt === 'all' ? 'All time' : `Last ${opt}` }}
      </button>
    </div>
    <div class="np-daterange">
      <label class="np-date-label">
        <span>From</span>
        <input
          type="date"
          class="np-date"
          data-np-from-date
          :value="customFrom.slice(0, 10)"
          @input="onDateInput('from', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="np-date-label">
        <span>From time</span>
        <input
          type="time"
          class="np-date np-time"
          data-np-from-time
          :value="customFromTime"
          :disabled="!customFrom"
          title="Optional — narrow the From day to a start time (e.g. a patch drop)"
          @input="onTimeInput('from', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="np-date-label">
        <span>To</span>
        <input
          type="date"
          class="np-date"
          data-np-to-date
          :value="customTo.slice(0, 10)"
          @input="onDateInput('to', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="np-date-label">
        <span>To time</span>
        <input
          type="time"
          class="np-date np-time"
          data-np-to-time
          :value="customToTime"
          :disabled="!customTo"
          title="Optional — cap the To day at an end time (inclusive minute)"
          @input="onTimeInput('to', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <button
        v-if="customFrom || customTo"
        class="np-date-clear"
        @click="clearDates"
      >
        Clear dates
      </button>
    </div>
    <div class="np-phrase">
      <label class="np-phrase-label">
        Or describe it
        <input
          v-model="phrase"
          class="np-phrase-input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          autocorrect="off"
          placeholder="last week, since Friday, this season"
          aria-describedby="np-phrase-error"
          :aria-invalid="phraseError ? 'true' : undefined"
          @keyup.enter="applyPhrase"
        >
      </label>
      <button class="np-phrase-apply" :disabled="!phrase.trim()" @click="applyPhrase">
        Apply
      </button>
      <p v-if="phraseError" id="np-phrase-error" class="np-phrase-error">
        {{ phraseError }}
      </p>
      <!--
        The announcement rides its own region, present from first render and
        never removed. A live region created in the same DOM mutation as its
        text is not announced by most screen readers, and a v-if'd one also
        stayed silent on a REPEATED refusal ("recently" twice) because Vue
        patched no text node. Clearing before setting makes an identical
        refusal transition through empty and announce again. Same shape as
        App.vue's parse status line; the visible paragraph above carries the
        sighted signal, so this one is invisible.
      -->
      <div class="sr-only" role="status" aria-live="polite">
        {{ phraseAnnouncement }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.np-phrase {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.4rem;
  margin-top: 0.5rem;
}

.np-phrase-label {
  display: flex;
  flex: 1 1 12rem;
  flex-direction: column;
  gap: 0.2rem;
  font-size: var(--type-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-dim);
}

.np-phrase-input {
  font-size: var(--type-sm);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.25rem 0.4rem;
}

.np-phrase-apply {
  font-size: var(--type-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.3rem 0.5rem;
}

/* --text-dim, not --text-mute: mute drops below AA on Day's darker surfaces
   and this is small content text carrying the refusal. */
.np-phrase-error {
  flex: 1 0 100%;
  margin: 0;
  font-size: var(--type-2xs);
  color: var(--text-dim);
}

.np-daterange {
  display: flex;
  gap: 0.4rem;
  align-items: end;
  flex-wrap: wrap;
}

.np-date-label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.np-date {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.25rem 0.4rem;
  font-family: var(--mono);
  font-size: var(--type-sm);
  color: var(--text);
  outline: 0;
  color-scheme: dark light;
}

.np-date:focus { border-color: var(--accent); }

.np-season {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 0.5rem;
}

.np-season-label {
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.np-season-select {
  flex: 1;
  min-width: 0;
}

.np-time {
  min-width: 5.4rem;
}

.np-time:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.np-date-clear {
  appearance: none;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.25rem 0.5rem;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
}

.np-date-clear:hover { color: var(--accent-text); border-color: var(--accent); }
</style>
