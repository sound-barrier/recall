<script setup>
import { ref, computed, onMounted } from 'vue'
import { ParseScreenshots, GetMatchResults } from '../wailsjs/go/main/App'

const records = ref([])
const error = ref('')
const loading = ref(false)

const filterType = ref('')
const filterRole = ref('')
const filterMap  = ref('')
const filterHero = ref('')

async function load() {
  const res = await GetMatchResults()
  records.value = res ?? []
}

async function parse() {
  error.value = ''
  loading.value = true
  try {
    await ParseScreenshots()
    await load()
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}

function uniqueValues(field) {
  const set = new Set()
  for (const r of records.value) {
    const v = r.data?.[field]
    if (v) set.add(v)
  }
  return [...set].sort()
}

const types = computed(() => uniqueValues('type'))
const roles = computed(() => uniqueValues('role'))
const maps  = computed(() => uniqueValues('map'))
const heroes = computed(() => uniqueValues('hero'))

const filtered = computed(() =>
  records.value.filter(r => {
    const d = r.data || {}
    if (filterType.value && d.type !== filterType.value) return false
    if (filterRole.value && d.role !== filterRole.value) return false
    if (filterMap.value  && d.map  !== filterMap.value)  return false
    if (filterHero.value && d.hero !== filterHero.value) return false
    return true
  })
)

function clearFilters() {
  filterType.value = ''
  filterRole.value = ''
  filterMap.value  = ''
  filterHero.value = ''
}

onMounted(load)
</script>

<template>
  <div class="container">
    <h1>OWMetrics</h1>

    <button @click="parse" :disabled="loading">
      {{ loading ? 'Parsing…' : 'Parse Screenshots' }}
    </button>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="records.length === 0 && !loading" class="empty">
      No results yet. Click "Parse Screenshots" to analyse the screenshots/ directory.
    </div>

    <div v-if="records.length > 0" class="filters">
      <select v-model="filterType">
        <option value="">All types</option>
        <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
      </select>
      <select v-model="filterRole">
        <option value="">All roles</option>
        <option v-for="r in roles" :key="r" :value="r">{{ r }}</option>
      </select>
      <select v-model="filterMap">
        <option value="">All maps</option>
        <option v-for="m in maps" :key="m" :value="m">{{ m }}</option>
      </select>
      <select v-model="filterHero">
        <option value="">All heroes</option>
        <option v-for="h in heroes" :key="h" :value="h">{{ h }}</option>
      </select>
      <button
        v-if="filterType || filterRole || filterMap || filterHero"
        class="clear" @click="clearFilters">
        Clear
      </button>
      <span class="count">{{ filtered.length }} / {{ records.length }}</span>
    </div>

    <div v-for="rec in filtered" :key="rec.id" class="card">
      <div class="card-header">
        <span class="map">{{ rec.data.map }}</span>
        <span v-if="rec.data.type" class="type">{{ rec.data.type }}</span>
        <span v-if="rec.data.mode" class="mode" :class="rec.data.mode">{{ rec.data.mode }}</span>
        <span v-if="rec.data.role" class="role" :class="rec.data.role">{{ rec.data.role }}</span>
        <span v-if="rec.data.hero" class="hero">{{ rec.data.hero }}</span>
        <span v-if="rec.data.result" class="result" :class="rec.data.result">{{ rec.data.result }}</span>
        <span class="source">{{ (rec.source_files || []).join(' + ') }}</span>
      </div>
      <div v-if="rec.data.final_score || rec.data.date || rec.data.game_length" class="meta">
        <div v-if="rec.data.final_score" class="meta-item"><label>Final Score</label><span>{{ rec.data.final_score }}</span></div>
        <div v-if="rec.data.date" class="meta-item"><label>Date</label><span>{{ rec.data.date }}<span v-if="rec.data.finished_at"> · {{ rec.data.finished_at }}</span></span></div>
        <div v-if="rec.data.type" class="meta-item"><label>Game Mode</label><span>{{ rec.data.type }}</span></div>
        <div v-if="rec.data.game_length" class="meta-item"><label>Game Length</label><span>{{ rec.data.game_length }}</span></div>
      </div>
      <div class="stats">
        <div class="stat"><label>Elims</label><span>{{ rec.data.eliminations }}</span></div>
        <div class="stat"><label>Assists</label><span>{{ rec.data.assists }}</span></div>
        <div class="stat"><label>Deaths</label><span>{{ rec.data.deaths }}</span></div>
        <div class="stat"><label>Damage</label><span>{{ rec.data.damage?.toLocaleString() }}</span></div>
        <div class="stat"><label>Healing</label><span>{{ rec.data.healing?.toLocaleString() }}</span></div>
        <div class="stat"><label>Mitigation</label><span>{{ rec.data.mitigation?.toLocaleString() }}</span></div>
      </div>
      <div v-if="rec.data.heroes_played?.length" class="heroes-played">
        <label>Heroes Played</label>
        <span v-for="hp in rec.data.heroes_played" :key="hp.hero" class="hero-play">
          {{ hp.hero }} · {{ hp.percent_played }}%<span v-if="hp.play_time"> · {{ hp.play_time }}</span>
        </span>
      </div>
      <div v-if="rec.data.personal_stats && Object.keys(rec.data.personal_stats).length" class="personal-stats">
        <label>Personal Stats</label>
        <div class="personal-grid">
          <div v-for="(v, k) in rec.data.personal_stats" :key="k" class="personal-item">
            <span class="personal-label">{{ k.replace(/_/g, ' ') }}</span>
            <span class="personal-value">{{ v }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #1a1a2e; color: #e0e0e0; font-family: sans-serif; }

.container { max-width: 800px; margin: 0 auto; padding: 2rem 1rem; }

h1 { font-size: 1.8rem; margin-bottom: 1.5rem; color: #7ec8e3; }

button {
  background: #0077b6; color: #fff; border: none;
  padding: 0.5rem 1.4rem; border-radius: 4px; cursor: pointer; font-size: 0.95rem;
}
button:hover:not(:disabled) { background: #005f92; }
button:disabled { opacity: 0.5; cursor: default; }

.error { color: #ff6b6b; margin-top: 1rem; font-size: 0.9rem; }
.empty { color: #888; margin-top: 2rem; }

.filters {
  display: flex; gap: 0.5rem; margin-top: 1.2rem; flex-wrap: wrap; align-items: center;
}
.filters select {
  background: #16213e; color: #e0e0e0; border: 1px solid #0f3460;
  border-radius: 4px; padding: 0.35rem 0.5rem; font-size: 0.9rem;
  text-transform: capitalize; cursor: pointer;
}
.filters select:focus { outline: none; border-color: #7ec8e3; }
.filters .clear {
  background: transparent; color: #888; border: 1px solid #444;
  padding: 0.3rem 0.7rem; font-size: 0.8rem;
}
.filters .clear:hover { color: #e0e0e0; border-color: #888; background: transparent; }
.filters .count { font-size: 0.8rem; color: #666; margin-left: auto; }

.card {
  background: #16213e; border: 1px solid #0f3460;
  border-radius: 6px; padding: 1rem; margin-top: 1.2rem;
}

.card-header {
  display: flex; align-items: center; gap: 0.8rem;
  margin-bottom: 0.8rem; flex-wrap: wrap;
}

.map { font-size: 1rem; font-weight: 600; text-transform: capitalize; color: #7ec8e3; }
.type { font-size: 0.7rem; padding: 2px 6px; border-radius: 3px; background: #0f3460; color: #aaa; text-transform: uppercase; letter-spacing: 0.05em; }
.mode { font-size: 0.7rem; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; font-weight: 700; }
.mode.competitive { background: #f0a50022; color: #f0a500; border: 1px solid #f0a50066; }
.mode.quickplay   { background: #4d94ff22; color: #7ec8e3; border: 1px solid #4d94ff66; }
.hero { font-size: 0.9rem; text-transform: capitalize; color: #f0a500; }
.source { font-size: 0.75rem; color: #555; margin-left: auto; }

.role {
  font-size: 0.75rem; padding: 2px 8px; border-radius: 10px;
  text-transform: uppercase; font-weight: 700;
}
.role.dps     { background: #ff4d4d22; color: #ff6b6b; border: 1px solid #ff4d4d66; }
.role.tank    { background: #4d94ff22; color: #7ec8e3; border: 1px solid #4d94ff66; }
.role.support { background: #4dff8822; color: #6bffb8; border: 1px solid #4dff8866; }

.result {
  font-size: 0.75rem; padding: 2px 8px; border-radius: 10px;
  text-transform: uppercase; font-weight: 700;
}
.result.victory { background: #4dff8822; color: #6bffb8; border: 1px solid #4dff8866; }
.result.defeat  { background: #ff4d4d22; color: #ff6b6b; border: 1px solid #ff4d4d66; }
.result.draw    { background: #88888822; color: #aaa;    border: 1px solid #88888866; }

.meta { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 0.8rem; }
.meta-item { display: flex; flex-direction: column; min-width: 6rem; }
.meta-item label { font-size: 0.65rem; color: #888; text-transform: uppercase; margin-bottom: 2px; }
.meta-item span  { font-size: 0.9rem; color: #e0e0e0; text-transform: capitalize; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; }

.heroes-played { margin-top: 0.8rem; display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; }
.heroes-played > label { font-size: 0.65rem; color: #888; text-transform: uppercase; }
.hero-play { font-size: 0.85rem; color: #e0e0e0; background: #0f3460; padding: 0.2rem 0.6rem; border-radius: 10px; text-transform: capitalize; }

.personal-stats { margin-top: 0.8rem; }
.personal-stats > label { display: block; font-size: 0.65rem; color: #888; text-transform: uppercase; margin-bottom: 0.4rem; }
.personal-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.4rem; }
.personal-item { background: #0f3460; border-radius: 4px; padding: 0.35rem 0.6rem; display: flex; justify-content: space-between; align-items: center; }
.personal-label { font-size: 0.7rem; color: #aaa; text-transform: capitalize; }
.personal-value { font-size: 0.9rem; font-weight: 700; color: #e0e0e0; }

.stat {
  background: #0f3460; border-radius: 4px; padding: 0.5rem 0.7rem;
  display: flex; flex-direction: column; align-items: center;
}
.stat label { font-size: 0.65rem; color: #888; text-transform: uppercase; margin-bottom: 2px; }
.stat span  { font-size: 1.1rem; font-weight: 700; }
</style>