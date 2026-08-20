import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import SendToCoachModal from '@/components/reviews/SendToCoachModal.vue'
import { setApiBacking } from '@/api-client'
import { useMatchesStore } from '@/stores/matches'
import { seedQuery } from '@/test-utils/queryTestUtils'
import { resetQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import type { MatchRecord } from '@/api'

// The dialog a player hands their matches to a coach through. What it has to
// get right is what leaves the machine: which matches, under whose handle,
// into a file they can find again — and a refusal they can read when one of
// those is missing.

function rec(key: string, replayCode: string): MatchRecord {
  return {
    match_key: key, source_files: [], source_types: {},
    data: { map: 'ilios', date: '2026-08-19' },
    annotation: replayCode ? { replay_code: replayCode } : undefined,
  } as unknown as MatchRecord
}

const READY = rec('m-1', 'AB12CD')
const BLOCKED = rec('m-2', '')

let exportBundle: ReturnType<typeof vi.fn>

function open(records: MatchRecord[], keys: string[]) {
  const store = useMatchesStore()
  seedQuery(qk.matches, records)
  store.records = records
  store.requestShare(keys, 'selection')
  return store
}

const user = () => userEvent.setup()
const handleField = () => screen.getByLabelText(/Your handle/)
const sendBtn = () => screen.getByRole('button', { name: /^Send$/ })

describe('SendToCoachModal', () => {
  beforeEach(() => {
    resetQueryClient()
    setActivePinia(createPinia())
    exportBundle = vi.fn(async () => '/Users/sable/Downloads/recall-share.zip')
    setApiBacking({
      ExportBundle: exportBundle,
      GetCoachingSettings: async () => ({ coach_name: '', player_handle: 'Sable' }),
    })
  })

  it('renders nothing until a share is requested', () => {
    render(SendToCoachModal)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // The component is lazy-loaded and rendered unconditionally, so it can mount
  // with the dialog ALREADY open. A plain (non-immediate) watcher never runs in
  // that case, and the filename stays empty — which the server falls back to
  // the BACKUP name for.
  it('fills the filename even when it mounts into an already-open share', async () => {
    const store = useMatchesStore()
    store.records = [READY]
    store.requestShare(['m-1'], 'row')
    render(SendToCoachModal)
    await nextTick()

    const saveAs = screen.getByLabelText(/Save as/) as HTMLInputElement
    expect(saveAs.value).toMatch(/^recall-share-\d{8}-\d{6}\.zip$/)
  })

  it('prefills the handle from settings, and sends exactly what was typed', async () => {
    render(SendToCoachModal)
    open([READY], ['m-1'])
    await nextTick()
    await vi.waitFor(() => expect(handleField()).toHaveValue('Sable'))

    await user().type(screen.getByLabelText(/Message for your coach/), 'ult timing')
    await user().click(sendBtn())

    await vi.waitFor(() => expect(exportBundle).toHaveBeenCalledTimes(1))
    expect(exportBundle.mock.calls[0]?.[0]).toMatchObject({
      matchKeys: ['m-1'],
      share: { handle: 'Sable', message: 'ult timing' },
      includeHidden: false,
      includeUnknown: false,
    })
  })

  // A coach reviews by watching the replay, so a match with no code is one
  // they cannot act on. The manifest names WHICH — the difference between a
  // refusal and an instruction.
  it('names the match that blocks the send, and refuses until it is fixed', async () => {
    render(SendToCoachModal)
    open([READY, BLOCKED], ['m-1', 'm-2'])
    await nextTick()

    expect(screen.getByText(/no replay code/)).toBeInTheDocument()
    expect(sendBtn()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot load a match without its replay code/)
    expect(exportBundle).not.toHaveBeenCalled()
  })

  // The reason a disabled button gives has to be readable — a title on a
  // disabled control is announced by nothing.
  it('says in text why it cannot send yet when the handle is empty', async () => {
    setApiBacking({
      ExportBundle: exportBundle,
      GetCoachingSettings: async () => ({ coach_name: '', player_handle: '' }),
    })
    render(SendToCoachModal)
    open([READY], ['m-1'])
    await nextTick()

    expect(sendBtn()).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/Enter the handle your coach knows you by/)
  })

  // The set can be the whole narrow. Everything below the list would then be
  // off screen at the moment the user decides to send — including the sentence
  // that says what is in the bundle.
  it('caps the manifest and says how many it did not list', async () => {
    const many = Array.from({ length: 20 }, (_, i) => rec(`m-${i}`, 'AB12CD'))
    render(SendToCoachModal)
    open(many, many.map((r) => r.match_key))
    await nextTick()

    expect(screen.getByText('…and 8 more')).toBeInTheDocument()
    expect(screen.getByText(/The bundle carries these matches whole/)).toBeInTheDocument()
  })
})
