import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { ExportDiagnosticBundle, OpenURL, PreflightDiagnosticBundle } from '@/api-client'
import type { LikelyCause, ReportFile } from '@/api-client'
import {
  candidateKey,
  parseProblemIssueURL,
  reportFiles,
  type ReportCandidate,
} from '@/components/report/parse-report'
import { useAppStore } from '@/stores/app'
import { useParseReportStore } from '@/stores/parseReport'
import { useSettingsStore } from '@/stores/settings'

/**
 * The parse-problem report dialog's working state: which candidates are
 * ticked, the note on each, what the preflight found, and the saved report
 * the GitHub issue is then prefilled from.
 *
 * Every candidate starts ticked — the user opened the dialog FROM these
 * files — and the state resets on each open, so one report's notes never
 * leak into the next.
 */
export function useParseReport() {
  const store = useParseReportStore()
  const { open, candidates } = storeToRefs(store)
  const appStore = useAppStore()
  const settingsStore = useSettingsStore()

  const picked = ref(new Set<string>())
  const notes = ref<Record<string, string>>({})
  const causes = ref<LikelyCause[]>([])
  const busy = ref(false)
  const savedAs = ref('')
  const savedFiles = ref<ReportFile[]>([])

  watch(open, (isOpen) => {
    if (!isOpen) return
    picked.value = new Set(candidates.value.map(candidateKey))
    notes.value = {}
    causes.value = []
    savedAs.value = ''
    savedFiles.value = []
    void preflight()
  }, { immediate: true })

  // Advisory: a failed check leaves the dialog without hints, never blocked.
  async function preflight() {
    try {
      causes.value = await PreflightDiagnosticBundle(reportFiles(candidates.value, {}))
    } catch {
      causes.value = []
    }
  }

  const pickedCandidates = computed(() => candidates.value.filter((c) => picked.value.has(candidateKey(c))))

  function isPicked(c: ReportCandidate): boolean {
    return picked.value.has(candidateKey(c))
  }

  function togglePicked(c: ReportCandidate) {
    const next = new Set(picked.value)
    const key = candidateKey(c)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    picked.value = next
  }

  function noteFor(c: ReportCandidate): string {
    return notes.value[candidateKey(c)] ?? ''
  }

  function setNote(c: ReportCandidate, text: string) {
    notes.value = { ...notes.value, [candidateKey(c)]: text }
  }

  // An empty saved name is the native dialog's cancel: stay quiet.
  async function save() {
    if (busy.value || pickedCandidates.value.length === 0) return
    busy.value = true
    const files = reportFiles(pickedCandidates.value, notes.value)
    try {
      const name = await ExportDiagnosticBundle(files)
      if (name) {
        savedAs.value = name
        savedFiles.value = files
      }
    } catch (e) {
      appStore.setErrorFromRaw(String(e))
    } finally {
      busy.value = false
    }
  }

  function openIssue() {
    OpenURL(parseProblemIssueURL({
      files: savedFiles.value,
      recallVersion: appStore.appVersion,
      platform: settingsStore.tesseractStatus.platform,
      tesseractVersion: settingsStore.tesseractStatus.version,
    }))
  }

  return {
    open, candidates, causes, busy, savedAs, pickedCandidates,
    isPicked, togglePicked, noteFor, setNote, save, openIssue,
    close: store.closeReport,
  }
}
