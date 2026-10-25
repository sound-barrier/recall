import { ref } from 'vue'
import { defineStore } from 'pinia'

import type { ReportCandidate } from '@/components/report/parse-report'

// Which screenshots the "Report a parse problem" dialog is open on. A store,
// not a component's state, because the dialog has several doors — the failed
// list, an Unknown card, a match's Source Screenshots — and lives in the
// overlay cluster, which reads every flag it renders from a store.
export const useParseReportStore = defineStore('parseReport', () => {
  const open = ref(false)
  const candidates = ref<ReportCandidate[]>([])

  function openReport(next: readonly ReportCandidate[]) {
    if (next.length === 0) return
    candidates.value = [...next]
    open.value = true
  }

  function closeReport() {
    open.value = false
  }

  return { open, candidates, openReport, closeReport }
})
