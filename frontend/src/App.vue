<script setup>
import { ref, onMounted } from 'vue'
import { ParseScreenshots, GetMatchResults } from '../wailsjs/go/main/App'

const records = ref([])
const error = ref('')
const loading = ref(false)

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

    <div v-for="rec in records" :key="rec.id" class="card">
      <div class="card-header">
        <span class="map">{{ rec.data.map }}</span>
        <span class="role" :class="rec.data.role">{{ rec.data.role }}</span>
        <span class="hero">{{ rec.data.characters?.join(', ') }}</span>
        <span class="source">{{ rec.source_file }}</span>
      </div>
      <div class="stats">
        <div class="stat"><label>Elims</label><span>{{ rec.data.eliminations }}</span></div>
        <div class="stat"><label>Assists</label><span>{{ rec.data.assists }}</span></div>
        <div class="stat"><label>Deaths</label><span>{{ rec.data.deaths }}</span></div>
        <div class="stat"><label>Damage</label><span>{{ rec.data.damage?.toLocaleString() }}</span></div>
        <div class="stat"><label>Healing</label><span>{{ rec.data.healing?.toLocaleString() }}</span></div>
        <div class="stat"><label>Mitigation</label><span>{{ rec.data.mitigation?.toLocaleString() }}</span></div>
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

.card {
  background: #16213e; border: 1px solid #0f3460;
  border-radius: 6px; padding: 1rem; margin-top: 1.2rem;
}

.card-header {
  display: flex; align-items: center; gap: 0.8rem;
  margin-bottom: 0.8rem; flex-wrap: wrap;
}

.map { font-size: 1rem; font-weight: 600; text-transform: capitalize; color: #7ec8e3; }
.hero { font-size: 0.9rem; text-transform: capitalize; color: #f0a500; }
.source { font-size: 0.75rem; color: #555; margin-left: auto; }

.role {
  font-size: 0.75rem; padding: 2px 8px; border-radius: 10px;
  text-transform: uppercase; font-weight: 700;
}
.role.dps     { background: #ff4d4d22; color: #ff6b6b; border: 1px solid #ff4d4d66; }
.role.tank    { background: #4d94ff22; color: #7ec8e3; border: 1px solid #4d94ff66; }
.role.support { background: #4dff8822; color: #6bffb8; border: 1px solid #4dff8866; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; }

.stat {
  background: #0f3460; border-radius: 4px; padding: 0.5rem 0.7rem;
  display: flex; flex-direction: column; align-items: center;
}
.stat label { font-size: 0.65rem; color: #888; text-transform: uppercase; margin-bottom: 2px; }
.stat span  { font-size: 1.1rem; font-weight: 700; }
</style>