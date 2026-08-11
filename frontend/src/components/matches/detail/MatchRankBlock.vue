<script setup lang="ts">
import type { MatchRecord } from '@/api-client'
import { useOWData } from '@/composables/shared/useOWData'

// The expanded card's Rank Update block — the "rare" milestone surface
// that only renders for matches carrying a rank-screen screenshot
// (placements / promos / demos): tier + level + progress + per-hero SR
// deltas. Extracted from MatchCardExpanded; read-only, just needs the
// record and the canonical hero-name lookup.
defineProps<{
  record: MatchRecord
}>()

const ow = useOWData()
</script>

<template>
  <!-- Rank update section. Only renders for matches that included
         a rank-screen screenshot (most don't — placements, promos,
         demos), so we lean into "rare" framing: distinct border,
         accent-glow background, a chevron eyebrow with a CHANGE
         tag so the user immediately reads it as a milestone, not
         another stat row. Sits above the journal so the milestone
         is read alongside the stats that produced it. -->
  <div v-if="record.data?.rank" class="rank-block rare">
    <div class="eyebrow block-eyebrow rank-eyebrow">
      <span class="rare-pip" aria-hidden="true">◆</span>
      Rank Update
    </div>
    <div class="rank-line">
      <span class="rank-tier" :class="record.data.rank">{{ record.data.rank }} {{ record.data.level }}</span>
      <span v-if="record.data.rank_progress" class="rank-progress">{{ record.data.rank_progress }}% progress</span>
      <span v-if="record.data.change_percent" class="rank-change">+{{ record.data.change_percent }}%</span>
      <span v-for="m in record.data.modifiers" :key="m" class="rank-modifier">{{ m }}</span>
    </div>
    <!-- One entry per hero — a real list so the per-hero grouping (hero /
         SR / delta belong together) and the reading ORDER are carried by
         the accessibility tree, not by the flex layout alone. -->
    <ul v-if="record.data.sr?.length" class="sr-line" aria-label="SR changes">
      <li v-for="s in record.data.sr" :key="s.hero" class="sr-entry">
        <span class="sr-hero">{{ ow.heroDisplayName(s.hero) }}</span>
        <span class="sr-value">{{ s.sr }}</span>
        <span class="sr-delta" :class="s.change >= 0 ? 'up' : 'down'">{{ s.change >= 0 ? '+' : '' }}{{ s.change }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
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
.rank-tier.diamond   { color: var(--rank-diamond);  border-color: color-mix(in srgb, var(--rank-diamond) 45%, transparent); }
.rank-tier.master    { color: var(--rank-master);   border-color: color-mix(in srgb, var(--rank-master) 45%, transparent); }
.rank-tier.grandmaster, .rank-tier.champion { color: var(--loss); border-color: var(--loss-line); }

.rank-progress {
  font-family: var(--mono);
  font-size: var(--type-sm);
  color: var(--text-dim);
  font-feature-settings: "tnum";
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
