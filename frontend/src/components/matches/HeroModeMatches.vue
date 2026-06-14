<script setup lang="ts">
// Level 2 of the Hero × Game-Mode band: the drilled map's most-recent
// games as a compact date / result / map list. Extracted from
// MatchHeroModeBand; the band passes the rows + map-name lookup down.
interface MatchRow {
  matchKey: string
  date: string
  finishedAt: string
  result: string
  map: string
}

defineProps<{
  matchRows: MatchRow[]
  mapLabel: (map: string) => string
}>()

// Short "Jun 5 · 7:42 PM" label; bare date when there's no finish time.
function matchDateLabel(m: { date: string; finishedAt: string }): string {
  if (!m.date) return '—'
  const d = new Date(m.date + 'T00:00:00')
  if (isNaN(d.getTime())) return m.date
  const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return m.finishedAt ? `${day} · ${m.finishedAt}` : day
}
</script>

<template>
  <div class="hm-matches" data-hero-mode-matches>
    <ol v-if="matchRows.length > 0" class="hm-match-list">
      <li v-for="m in matchRows" :key="m.matchKey" class="hm-match-row">
        <span class="hm-match-date">{{ matchDateLabel(m) }}</span>
        <span class="hm-match-result" :class="`res-${m.result}`">{{ m.result || '—' }}</span>
        <span class="hm-match-map">{{ mapLabel(m.map) }}</span>
      </li>
    </ol>
    <p v-else class="hm-drill-empty">
      No matches in this window.
    </p>
  </div>
</template>

<style scoped>
.hm-matches { margin-top: 0.4rem; }

.hm-match-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hm-match-row {
  display: grid;
  grid-template-columns: 9rem 5rem 1fr;
  align-items: center;
  gap: 0.6rem;
  padding: 0.32rem 0.5rem;
  background: var(--surface-2);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.68rem;
}

.hm-match-date { color: var(--text); letter-spacing: 0.03em; }

.hm-match-result {
  justify-self: start;
  font-size: 0.56rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 0.08rem 0.4rem;
  border-radius: 2px;
}
.res-victory { background: color-mix(in srgb, var(--win) 22%, transparent); color: var(--win); }
.res-defeat  { background: color-mix(in srgb, var(--loss) 22%, transparent); color: var(--loss); }
.res-draw    { background: color-mix(in srgb, var(--draw) 22%, transparent); color: var(--draw); }

.hm-match-map {
  color: var(--text-faint);
  letter-spacing: 0.03em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: capitalize;
}


.hm-drill-empty {
  margin: 0.6rem 0 0.1rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-faint);
  letter-spacing: 0.04em;
}
</style>
