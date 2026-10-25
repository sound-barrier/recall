<script setup lang="ts">
import type { MatchRecord } from '@/api-client'
import { candidatesFromRecord } from '@/components/report/parse-report'
import { useParseReportStore } from '@/stores/parseReport'

// The door into the parse-problem report from a record's source list — a
// match card, an Unknown card, a "Needs your review" card. Opens the dialog
// on every source file of the record; the user unticks the ones that read
// fine.
const props = defineProps<{
  record: Pick<MatchRecord, 'source_files' | 'source_dir_ids'>
}>()

const parseReport = useParseReportStore()
</script>

<template>
  <button
    type="button"
    class="btn ghost report-parse-problem"
    @click.stop="parseReport.openReport(candidatesFromRecord(props.record))"
  >
    Report parse problem…
  </button>
</template>

<style scoped>
.report-parse-problem {
  margin-top: var(--space-2);
  align-self: flex-start;
}
</style>
