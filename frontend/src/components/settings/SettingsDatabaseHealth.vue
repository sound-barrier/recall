<script setup lang="ts">
import { useDatabaseHealth } from '@/composables/settings/useDatabaseHealth'

// Settings → Advanced → Database health: integrity_check + size /
// freelist stats on demand, plus the optimize / compact maintenance
// operations (the audit's "no live-DB health surface" gap, promoted
// from the FEATURES.md triage list). User-pulled only; nothing here runs at
// boot, and deliberately uncached — a stale integrity check is worse than
// none, and two of the three passes change what they report on.

const { report, busy, run } = useDatabaseHealth()

function mb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

function localTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString()
}
</script>

<template>
  <div class="setting-row" data-db-health>
    <div class="setting-info">
      <h4 class="setting-label">
        Database health
      </h4>
      <p class="setting-desc">
        Run an integrity check, or reclaim space after deleting many
        matches. Compact rebuilds the database file and pauses briefly
        — it waits for any running parse.
      </p>
      <dl v-if="report" class="dbh-report" :class="{ 'dbh-bad': report.integrity !== 'ok' }">
        <div class="dbh-item">
          <dt>Integrity</dt>
          <dd data-db-integrity>
            {{ report.integrity }}
          </dd>
        </div>
        <div class="dbh-item">
          <dt>Size</dt>
          <dd>{{ mb(report.size_bytes) }}</dd>
        </div>
        <div class="dbh-item">
          <dt>Reclaimable</dt>
          <dd>{{ report.freelist_pages }} page{{ report.freelist_pages === 1 ? '' : 's' }}</dd>
        </div>
        <div class="dbh-item">
          <dt>WAL</dt>
          <dd>{{ mb(report.wal_bytes) }}</dd>
        </div>
        <div class="dbh-item">
          <dt>Checked</dt>
          <dd>{{ localTime(report.checked_at) }}</dd>
        </div>
      </dl>
    </div>
    <div class="setting-control dbh-controls">
      <button class="btn" :disabled="busy !== null" @click="run('check')">
        {{ busy === 'check' ? 'Checking…' : 'Check health' }}
      </button>
      <button class="btn" :disabled="busy !== null" @click="run('optimize')">
        {{ busy === 'optimize' ? 'Optimizing…' : 'Optimize' }}
      </button>
      <button class="btn" :disabled="busy !== null" @click="run('vacuum')">
        {{ busy === 'vacuum' ? 'Compacting…' : 'Compact' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.dbh-controls {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  align-items: stretch;
}

.dbh-report {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.2rem;
  margin: 0.6rem 0 0;
}

.dbh-item {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}

.dbh-item dt {
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.dbh-item dd {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--type-sm);
  color: var(--text);
}

.dbh-bad [data-db-integrity] {
  color: var(--loss);
  font-weight: 700;
}
</style>
