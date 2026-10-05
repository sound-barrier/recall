<script setup lang="ts">
import { useOWData } from '@/composables/shared/useOWData'

// Read-only "Supported capture-source rules" surface in Settings →
// Advanced: a collapsible table of the filename shapes the parser
// recognizes per capture tool, rendered from the loaded reference data
// (pkg/parser/screenshot_sources.yaml). Extracted from SettingsAdvanced so
// the settings panel sheds this static reference block.
const { data: owData } = useOWData()
</script>

<template>
  <!-- Supported capture-source rules — read-only surface so the
           user can verify which filename shapes the parser recognizes
           without leaving the app. Closed by default; power-user
           surface only. -->
  <details class="setting-row capture-source-row" data-supported-formats>
    <summary class="capture-source-summary">
      <span class="setting-label">Supported capture-source rules</span>
      <span class="capture-source-summary-hint">
        {{ owData?.screenshot_sources?.length ?? 0 }} filename formats recognized
      </span>
    </summary>
    <div class="capture-source-body">
      <p class="setting-desc">
        The parser recognizes these filename shapes per capture
        tool. Source-of-truth is the YAML in
        <code>pkg/parser/screenshot_sources.yaml</code>; this
        table renders the loaded entries.
      </p>
      <table class="capture-source-table">
        <thead>
          <tr>
            <th scope="col">
              Tool
            </th>
            <th scope="col">
              Prefix
            </th>
            <th scope="col">
              Regex
            </th>
            <th scope="col">
              Example filename
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="src in owData?.screenshot_sources ?? []"
            :key="src.name"
            :data-source-name="src.name"
          >
            <td>{{ src.name }}</td>
            <td><code>{{ src.prefix }}</code></td>
            <td><code class="capture-source-regex">{{ src.regex }}</code></td>
            <td><code>{{ src.example }}</code></td>
          </tr>
        </tbody>
      </table>
    </div>
  </details>
</template>

<style scoped>
/* Supported capture-source rules — read-only collapsible. */
.capture-source-row {
  display: block; /* override the .setting-row flex shape inherited from parent */
  padding: 0;
}

.capture-source-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-4);
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.capture-source-summary::-webkit-details-marker { display: none; }

.capture-source-summary::before {
  content: '▸';
  display: inline-block;
  margin-right: var(--space-2);
  color: var(--text-faint);
  transition: transform var(--duration-fast) ease;
}

details[open] > .capture-source-summary::before {
  transform: rotate(90deg);
  color: var(--accent-text);
}

.capture-source-summary-hint {
  font-family: var(--mono);
  font-size: var(--type-xs);
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.capture-source-body {
  padding: var(--space-1) var(--space-4) var(--space-4);
}

.capture-source-table {
  width: 100%;
  margin-top: var(--space-2);
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: var(--type-xs);
}

.capture-source-table th {
  text-align: left;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border);
}

.capture-source-table td {
  padding: var(--space-2) var(--space-2);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  color: var(--text);
  vertical-align: top;
}

.capture-source-table code {
  font-family: var(--mono);
  font-size: var(--type-xs);
  word-break: break-all;
}

.capture-source-regex {
  color: var(--accent-text);
}

.reparse-progress-line {
  margin: var(--space-2) 0 0;
  font-family: var(--mono);
  font-size: var(--type-xs);
  letter-spacing: 0.06em;
  color: var(--accent-text);
  text-align: right;
}
</style>
