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
    <div class="block-eyebrow rank-eyebrow">
      <span class="rare-pip" aria-hidden="true">◆</span>
      Rank Update
    </div>
    <div class="rank-line">
      <span class="rank-tier" :class="record.data.rank">{{ record.data.rank }} {{ record.data.level }}</span>
      <span v-if="record.data.rank_progress" class="rank-progress">{{ record.data.rank_progress }}% progress</span>
      <span v-if="record.data.change_percent" class="rank-change">+{{ record.data.change_percent }}%</span>
      <span v-for="m in record.data.modifiers" :key="m" class="rank-modifier">{{ m }}</span>
    </div>
    <div v-if="record.data.sr?.length" class="sr-line">
      <span v-for="s in record.data.sr" :key="s.hero" class="sr-entry">
        <span class="sr-hero">{{ ow.heroDisplayName(s.hero) }}</span>
        <span class="sr-value">{{ s.sr }}</span>
        <span class="sr-delta" :class="s.change >= 0 ? 'up' : 'down'">{{ s.change >= 0 ? '+' : '' }}{{ s.change }}</span>
      </span>
    </div>
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
  border-radius: 4px;
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
  border-radius: 0 2px 2px 0;
  background: var(--accent);
  opacity: 0.85;
}

.rank-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--accent-bright, var(--accent));
  letter-spacing: 0.24em;
}

.rare-pip {
  display: inline-block;
  color: var(--accent);
  font-size: 0.7rem;
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
  font-size: 0.95rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.2rem 0.6rem;
  border-radius: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
}
.rank-tier.bronze    { color: #d18a4a; border-color: rgb(209 138 74 / 45%); }
.rank-tier.silver    { color: #d6d6d6; border-color: rgb(214 214 214 / 40%); }
.rank-tier.gold      { color: #ffd770; border-color: rgb(255 215 112 / 45%); }
.rank-tier.platinum  { color: #7befd9; border-color: rgb(123 239 217 / 45%); }
.rank-tier.diamond   { color: #c2e6ff; border-color: rgb(194 230 255 / 45%); }
.rank-tier.master    { color: #d6b4ff; border-color: rgb(214 180 255 / 45%); }
.rank-tier.grandmaster, .rank-tier.champion { color: var(--loss); border-color: var(--loss-line); }

.rank-progress {
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

.rank-change {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--win);
  font-weight: 600;
  font-feature-settings: "tnum";
}

.rank-modifier {
  font-size: 0.62rem;
  padding: 0.18rem 0.5rem;
  background: var(--surface-3);
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.sr-line { display: flex; flex-wrap: wrap; gap: 0.7rem; }

.sr-entry {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.25rem 0.55rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  font-size: 0.78rem;
}
.sr-hero  { color: var(--text-dim); text-transform: capitalize; font-size: 0.75rem; }
.sr-value { font-family: var(--mono); color: var(--text); font-weight: 600; font-feature-settings: "tnum"; }
.sr-delta { font-family: var(--mono); font-size: 0.7rem; font-weight: 600; font-feature-settings: "tnum"; }
.sr-delta.up   { color: var(--win); }
.sr-delta.down { color: var(--loss); }

</style>
