import { describe, expect, it, vi } from 'vitest'

import { setApiBacking } from '@/api-client'
import { attachFrame } from '@/composables/coach/useMomentAttachment'
import type { CoachMoment } from '@/match/coach/coach-moments'

// A frame upload takes as long as it takes, and the moment does not stand
// still meanwhile. What comes back has to be the moment as it is NOW, with
// the frame on it — not a snapshot from before the upload.

const moment = (text: string): CoachMoment => ({ momentId: 'm-1', matchClock: '04:45', text, focusTag: '', imageSHA256: '' })

function uploading() {
  let finish: (sha: string) => void = () => {}
  setApiBacking({ PutMomentImage: vi.fn(() => new Promise<string>((resolve) => { finish = resolve })) })
  return { finish: (sha: string) => { finish(sha) } }
}

describe('attachFrame', () => {
  it('keeps what was typed while the frame uploaded', async () => {
    const upload = uploading()
    let current: CoachMoment | undefined = moment('before')
    const attached = attachFrame(new File(['x'], 'f.png'), () => current)
    current = moment('typed during the upload')
    upload.finish('sha-1')

    expect(await attached).toEqual({ ...moment('typed during the upload'), imageSHA256: 'sha-1' })
  })

  it('brings back nothing for a moment deleted while its frame uploaded', async () => {
    const upload = uploading()
    let current: CoachMoment | undefined = moment('before')
    const attached = attachFrame(new File(['x'], 'f.png'), () => current)
    current = undefined
    upload.finish('sha-1')

    expect(await attached).toBeNull()
  })
})
