<script setup lang="ts">
import { computed, ref } from 'vue'

import type { MatchRecord, UserMatchDataInput } from '@/api-client'
import { useOWData } from '@/composables/shared/useOWData'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { hasRankScreenshot } from '@/match/match-helpers'
import { withRankFill } from '@/match/match-overrides'
import { TIER_ORDER, isPlaceableRank } from '@/match/trends/match-trends-helpers'

// The expanded card's Rank Update block — the "rare" milestone surface
// that only renders for matches carrying a rank-screen screenshot
// (placements / promos / demos): tier + level + progress + per-hero SR
// deltas. Extracted from MatchCardExpanded; read-only, just needs the
// record and the canonical hero-name lookup.
const props = defineProps<{
  record: MatchRecord
}>()

const emit = defineEmits<{
  // Carries the FULL override set, like every other edit on this surface —
  // UpdateMatchData replaces the set wholesale.
  'update-match-data': [matchKey: string, overrides: UserMatchDataInput]
}>()

const ow = useOWData()
const { writesLocked, lockedTitle } = useWriteGate()

// The block renders when a tier is known OR a rank screenshot was parsed at
// all. Before this, it was gated on the tier alone, so a capture whose tier
// band was unreadable rendered NOTHING and was indistinguishable from a match
// that never had a rank screen — the app's own recovery of that capture was
// invisible to the person it was recovered for.
const show = computed(() => !!props.record.data?.rank || hasRankScreenshot(props.record))

// Incomplete by the SAME rule the rank charts use, so the sentence below can
// name the actual consequence instead of guessing at it.
const incomplete = computed(() => !isPlaceableRank(props.record.data))

// Names what is actually missing. A tier can be present while the division is
// not — `level` is omitempty on the wire, so a division of 0 arrives absent —
// and telling the user "tier" when the tier is right there would read as a bug.
const missing = computed(() =>
  props.record.data?.rank ? 'division' : 'tier and division')

const TIERS = TIER_ORDER.map((t) => ({ value: t, label: t[0]!.toUpperCase() + t.slice(1) }))
const DIVISIONS = [1, 2, 3, 4, 5]

const fillTier = ref('')
const fillDivision = ref(1)
const canSave = computed(() => !writesLocked.value && fillTier.value !== '')

function saveRank() {
  if (!canSave.value) return
  emit('update-match-data', props.record.match_key,
    withRankFill(props.record, fillTier.value, fillDivision.value))
}
</script>

<template>
  <!-- Rank update section. Only renders for matches that included
         a rank-screen screenshot (most don't — placements, promos,
         demos), so we lean into "rare" framing: distinct border,
         accent-glow background, a chevron eyebrow with a CHANGE
         tag so the user immediately reads it as a milestone, not
         another stat row. Sits above the journal so the milestone
         is read alongside the stats that produced it. -->
  <div v-if="show" class="rank-block rare">
    <div class="eyebrow block-eyebrow rank-eyebrow">
      <span class="rare-pip" aria-hidden="true">◆</span>
      Rank Update
    </div>
    <div class="rank-line">
      <span v-if="record.data?.rank" class="rank-tier" :class="record.data.rank">{{ record.data.rank }} {{ record.data.level }}</span>
      <!-- The slot the reader's eye goes to answers the question, rather than
           being silently absent. -->
      <span v-else class="rank-tier rank-tier-unread">Tier not read</span>
      <!-- `!= null`, not truthiness, on both: 0 is a real reading. 0% progress
           is the bottom of a division and a 0 change is "this match moved the
           rank by nothing" — hiding either claims the screenshot never reported
           it. The sign comes from the VALUE: change_percent went signed when
           the parser learned to read demotions, and a hardcoded '+' rendered
           "+-32%" on the seven captures that carry a negative. Same shape as
           the SR delta below. -->
      <span v-if="record.data.rank_progress != null" class="rank-progress">{{ record.data.rank_progress }}% progress</span>
      <span v-if="record.data.change_percent != null" class="rank-change">{{ record.data.change_percent >= 0 ? '+' : '' }}{{ record.data.change_percent }}%</span>
      <span v-for="m in record.data.modifiers" :key="m" class="rank-modifier">{{ m }}</span>
    </div>
    <!-- Names the LOSS, not just the gap, because the loss is what the reader
         can check. It points at Source Screenshots because that is the actual
         recovery path — the capture is still on disk and opens in the lightbox.
         It deliberately does NOT say "re-parse": on the capture this exists for,
         the tier is occluded by a hero model in the pixels, and every empty-tier
         golden was produced by the CURRENT parser, so a re-parse is a guaranteed
         no-op and offering it would waste the user's time. -->
    <div v-if="incomplete" class="rank-incomplete">
      <p class="rank-note">
        This match's rank screen was captured, but its {{ missing }} could not be
        read — so the match is missing from the rank charts. Read it off the
        capture in Source Screenshots below and enter it here:
      </p>
      <div class="rank-fill">
        <label class="rank-fill-field">
          Tier
          <select v-model="fillTier" class="rank-fill-input">
            <option value="">Choose…</option>
            <option v-for="t in TIERS" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </label>
        <label class="rank-fill-field">
          Division
          <select v-model.number="fillDivision" class="rank-fill-input">
            <option v-for="d in DIVISIONS" :key="d" :value="d">{{ d }}</option>
          </select>
        </label>
        <button
          type="button"
          class="btn ghost"
          :disabled="!canSave"
          :title="lockedTitle('Save this rank onto the match')"
          @click="saveRank"
        >
          Save rank
        </button>
      </div>
    </div>
    <!-- A SENTENCE, not a chip beside the real modifiers. A chip would assert
         this text IS a modifier the player earned; the only supported claim is
         that the vocabulary could not explain it — the same detection fires on
         roughly 8% of rank captures that carry no new chip at all. Rendering it
         as prose is the honest strength of that evidence, and it keeps the
         unrecognized text out of the modifier row the filters count against. -->
    <p v-if="record.data.modifiers_raw" class="rank-unknown-modifier">
      Recall read <code>{{ record.data.modifiers_raw }}</code> in the modifier
      row and does not recognize it.
    </p>
    <!-- Season-4 population share. `!= null` rather than a truthiness test:
         0 is a real reading ("above nobody"), and `v-if="…rank_percentile"`
         would silently hide it — the rule the progress/change lines above now
         follow too. Absent stays absent: a placement screen reports no
         percentile, and printing 0% there would state something false rather
         than nothing. The wording is carried in the text because "57%" beside
         "67% progress" is two bare percentages the reader has to tell apart. -->
    <div v-if="record.data.rank_percentile != null" class="rank-percentile">
      Higher ranked than <strong>{{ record.data.rank_percentile }}%</strong> of players
    </div>
    <!-- One entry per hero — a real list so the per-hero grouping (hero /
         SR / delta belong together) and the reading ORDER are carried by
         the accessibility tree, not by the flex layout alone. -->
    <ul v-if="record.data.sr?.length" class="sr-line" aria-label="SR changes">
      <li v-for="s in record.data.sr" :key="s.hero" class="sr-entry">
        <span class="sr-hero">{{ ow.heroDisplayName(s.hero) }}</span>
        <span class="sr-value">{{ s.sr }}</span>
        <span v-if="s.change === undefined" class="sr-delta sr-delta-unread">not read</span>
        <span v-else class="sr-delta" :class="s.change >= 0 ? 'up' : 'down'">{{ s.change >= 0 ? '+' : '' }}{{ s.change }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* Same rule as the unread tier beside it: a movement nobody read says so,
   rather than borrowing the up-tint and printing +0. */
.sr-delta-unread {
  color: var(--text-faint);
  font-style: italic;
}

/* The unread-tier chip keeps the tier slot's shape so the line does not
   reflow, but drops the tier coloring it has no tier to earn. */
.rank-tier-unread {
  font-family: inherit;
  font-size: var(--type-md);
  font-weight: 600;
  text-transform: none;
  letter-spacing: normal;
  color: var(--text-dim);
  border-style: dashed;
}

.rank-incomplete {
  margin-top: 0.5rem;
}

.rank-note {
  margin: 0 0 0.5rem;
  font-size: var(--type-sm);
  color: var(--text-dim);
}

.rank-fill {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.5rem;
}

.rank-fill-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: var(--type-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-dim);
}

.rank-fill-input {
  font-size: var(--type-sm);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.25rem 0.4rem;
}

/* Muted, but --text-dim not --text-mute: mute drops to 3.98:1 on Day's darker
   surfaces, and this is small content text that has to clear AA. */
.rank-unknown-modifier {
  margin: 0.35rem 0 0;
  font-size: var(--type-sm);
  color: var(--text-dim);
}

.rank-unknown-modifier code {
  font-family: inherit;
  font-weight: 600;
  color: var(--text);
}

/* ─── Rank block ─────────────────────────────────────────── */

/* Rare-section framing. Rank updates are uncommon (placements,
   promotions, demotions), so when one is present we want it to
   read as a milestone — colored border, accent-tinted background
   gradient, a diamond pip on the eyebrow. The base .rank-block
   without `.rare` (legacy inline-expand callers, if any) keeps
   the flat look. */
.rank-block.rare {
  position: relative;
  padding: 0.85rem 1rem 0.9rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--accent-soft);
  background:
    linear-gradient(135deg, rgb(245 166 35 / 7%) 0%, rgb(245 166 35 / 0%) 60%),
    var(--surface-2);
  box-shadow: 0 0 0 1px rgb(245 166 35 / 8%);
}

/* A thin accent strip along the left edge of the rare rank block —
   echoes the result-tinted strip on the panel itself and reads as
   a "this is highlighted" affordance without screaming. */
.rank-block.rare::before {
  content: '';
  position: absolute;
  left: 0; top: 10%;
  width: 3px; height: 80%;
  border-radius: 0 var(--radius) var(--radius) 0;
  background: var(--accent);
  opacity: 0.85;
}

.rank-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--accent-bright);
  letter-spacing: 0.24em;
}

.rare-pip {
  display: inline-block;
  color: var(--accent-text);
  font-size: var(--type-sm);
  transform: translateY(-0.05em);
  text-shadow: 0 0 8px var(--accent-glow);
}

.rank-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.rank-tier {
  font-family: var(--display);
  font-size: var(--type-xl);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.2rem 0.6rem;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
}

/* Borders derive from the same token so a tier can never drift into
   two different colors, and both follow the theme. */
.rank-tier.bronze    { color: var(--rank-bronze);   border-color: color-mix(in srgb, var(--rank-bronze) 45%, transparent); }
.rank-tier.silver    { color: var(--rank-silver);   border-color: color-mix(in srgb, var(--rank-silver) 40%, transparent); }
.rank-tier.gold      { color: var(--rank-gold);     border-color: color-mix(in srgb, var(--rank-gold) 45%, transparent); }
.rank-tier.platinum  { color: var(--rank-platinum); border-color: color-mix(in srgb, var(--rank-platinum) 45%, transparent); }
.rank-tier.emerald   { color: var(--rank-emerald); border-color: color-mix(in srgb, var(--rank-emerald) 45%, transparent); }
.rank-tier.diamond   { color: var(--rank-diamond);  border-color: color-mix(in srgb, var(--rank-diamond) 45%, transparent); }
.rank-tier.master    { color: var(--rank-master);   border-color: color-mix(in srgb, var(--rank-master) 45%, transparent); }
.rank-tier.grandmaster, .rank-tier.champion { color: var(--loss); border-color: var(--loss-line); }

.rank-progress {
  font-family: var(--mono);
  font-size: var(--type-sm);
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

/* A sentence, not a stat chip: it sits on its own line below the tier row so
   its "57%" is never read as a second reading of the same thing the
   progress chip beside it reports. */
.rank-percentile {
  margin-top: var(--space-1);
  font-size: var(--type-xs);
  color: var(--text-dim);
}

.rank-percentile strong {
  font-family: var(--mono);
  font-feature-settings: "tnum";
  color: var(--text);
}

.rank-change {
  font-family: var(--mono);
  font-size: var(--type-md);
  color: var(--win);
  font-weight: 600;
  font-feature-settings: "tnum";
}

.rank-modifier {
  font-size: var(--type-2xs);
  padding: 0.18rem 0.5rem;
  background: var(--surface-3);
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

/* A <ul> for the semantics; the UA list box model is reset so the row
   paints exactly as the former flex <div> did. */
.sr-line { display: flex; flex-wrap: wrap; gap: 0.7rem; list-style: none; margin: 0; padding: 0; }

.sr-entry {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.25rem 0.55rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: var(--type-md);
}
.sr-hero  { color: var(--text-dim); text-transform: capitalize; font-size: var(--type-sm); }
.sr-value { font-family: var(--mono); color: var(--text); font-weight: 600; font-feature-settings: "tnum"; }
.sr-delta { font-family: var(--mono); font-size: var(--type-sm); font-weight: 600; font-feature-settings: "tnum"; }
.sr-delta.up   { color: var(--win); }
.sr-delta.down { color: var(--loss); }

</style>
