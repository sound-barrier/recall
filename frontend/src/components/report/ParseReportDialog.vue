<script setup lang="ts">
import { computed } from 'vue'

import { useModalFocusTrap } from '@/composables/shared/keyboard/useModalFocusTrap'
import { useParseReport } from '@/composables/report/useParseReport'
import {
  candidateKey,
  causesForFile,
  LARGE_REPORT_FILES,
  setupCauses,
} from '@/components/report/parse-report'

// "Report a parse problem" — the one export for every kind of bad parse: a
// screenshot that errored, one stuck in the Unknown tab, one that parsed into
// the wrong hero. The user ticks the files, says what each should have read
// (the one fact only they know, and what the maintainer corrects a golden to),
// saves a zip with folder paths stripped, then opens a GitHub issue prefilled
// from those notes.
//
// What the preflight found sits above everything else: a Tesseract 4 install
// or an ultrawide capture looks exactly like a parser bug from the user's
// chair, and the fix is theirs to make in a minute. Reporting stays allowed —
// the hint is a hint, not a gate.
//
// Reads the store directly and takes no props — the overlay cluster's rule.

const report = useParseReport()
const { open, candidates, causes, busy, savedAs, pickedCandidates } = report

const generalCauses = computed(() => setupCauses(causes.value))
const tooLarge = computed(() => pickedCandidates.value.length > LARGE_REPORT_FILES)
const canSave = computed(() => !busy.value && pickedCandidates.value.length > 0)

useModalFocusTrap(open, {
  containerSelector: '.parse-report-box',
  onClose: () => report.close(),
  keepOpenOnFieldEscape: true,
})

function noteId(index: number): string {
  return `parse-report-note-${index}`
}
</script>

<template>
  <div
    v-if="open"
    class="sheet-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="parse-report-title"
    aria-describedby="parse-report-desc"
  >
    <div class="sheet-backdrop" aria-hidden="true" @click="report.close()" />
    <form class="sheet-box parse-report-box" @submit.prevent="report.save()">
      <p class="eyebrow accent sheet-fixed">
        Help fix the parser
      </p>
      <h2 id="parse-report-title" class="sheet-fixed sheet-title">
        Report a parse problem
      </h2>
      <p id="parse-report-desc" class="sheet-fixed parse-report-desc">
        Tick the screenshots Recall read wrong and say what each should have
        said. Recall saves a <code>.zip</code> of those images, its logs and
        version info, with your folder paths removed, for you to attach to a
        GitHub issue.
      </p>

      <div class="sheet-body">
        <section v-if="generalCauses.length" class="parse-report-causes" aria-labelledby="parse-report-causes-title">
          <h3 id="parse-report-causes-title" class="parse-report-label">
            Check this first
          </h3>
          <p v-for="c in generalCauses" :key="c.code" class="parse-report-cause">
            {{ c.message }}
          </p>
        </section>

        <ul class="parse-report-files" aria-label="Screenshots in this report">
          <li v-for="(c, i) in candidates" :key="candidateKey(c)" class="parse-report-file">
            <label class="parse-report-pick">
              <input
                type="checkbox"
                :checked="report.isPicked(c)"
                :aria-label="`Include ${c.filename}`"
                :disabled="busy"
                @change="report.togglePicked(c)"
              >
              <span class="parse-report-name mono">{{ c.filename }}</span>
            </label>
            <p
              v-for="fc in causesForFile(causes, c.filename)"
              :key="fc.code"
              class="parse-report-cause"
            >
              {{ fc.message }}
            </p>
            <template v-if="report.isPicked(c)">
              <label class="parse-report-label" :for="noteId(i)">
                What’s wrong with {{ c.filename }}?
              </label>
              <textarea
                :id="noteId(i)"
                class="parse-report-note"
                rows="2"
                maxlength="2000"
                placeholder="e.g. hero should be Kiriko, or this is a SUMMARY tab"
                :value="report.noteFor(c)"
                :disabled="busy"
                @input="report.setNote(c, ($event.target as HTMLTextAreaElement).value)"
              />
            </template>
          </li>
        </ul>

        <p class="parse-report-privacy">
          Screenshots show BattleTags on the scoreboard. Crop them out before
          attaching if you'd rather not share them.
        </p>
        <p v-if="tooLarge" class="parse-report-privacy" role="status">
          GitHub takes attachments up to 25 MB, about {{ LARGE_REPORT_FILES }}
          screenshots. Split a bigger report across issues.
        </p>
        <p v-if="savedAs" class="parse-report-saved" role="status">
          ✓ Saved {{ savedAs }}. Open an issue and drag that file into it.
        </p>
      </div>

      <div class="sheet-fixed parse-report-actions">
        <button type="button" class="btn-mono is-lg" :disabled="busy" @click="report.close()">
          {{ savedAs ? 'Done' : 'Cancel' }}
        </button>
        <button
          v-if="savedAs"
          type="button"
          class="btn-mono is-lg is-primary"
          @click="report.openIssue()"
        >
          Open a GitHub issue
        </button>
        <button
          v-else
          type="submit"
          class="btn-mono is-lg is-primary"
          :disabled="!canSave"
          :aria-describedby="pickedCandidates.length === 0 ? 'parse-report-blocked' : undefined"
        >
          {{ busy ? 'Building…' : 'Save report…' }}
        </button>
      </div>
      <p
        v-if="pickedCandidates.length === 0"
        id="parse-report-blocked"
        class="sheet-fixed parse-report-blocked"
        role="status"
      >
        Tick at least one screenshot to report.
      </p>
    </form>
  </div>
</template>

<style scoped src="./parse-report-dialog.css"></style>
