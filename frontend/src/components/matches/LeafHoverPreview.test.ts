import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

import type { MatchRecord } from '@/api'
import LeafHoverPreview from '@/components/matches/LeafHoverPreview.vue'

// The preview teleports to document.body, so assertions query the body.
let wrapper: VueWrapper | null = null
function mountPreview(props: { src?: string | null; source?: MatchRecord['source']; editedFields?: string[] }) {
  wrapper = mount(LeafHoverPreview, { props: { x: 0, y: 0, src: null, ...props } })
  return wrapper
}
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('LeafHoverPreview', () => {
  it('renders the screenshot thumbnail when src is set', () => {
    mountPreview({ src: '/_screenshot/foo.png' })
    const img = document.body.querySelector<HTMLImageElement>('.leaf-hover-preview img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toContain('foo.png')
  })

  it('captions an edited match with the provenance badge', () => {
    mountPreview({ src: '/_screenshot/foo.png', source: 'ocr_edited', editedFields: ['data.map'] })
    const prov = document.body.querySelector('[data-hover-prov]')
    expect(prov).not.toBeNull()
    expect(prov!.textContent).toContain('Edited')
  })

  it('shows the badge for a manual match even with no screenshot', () => {
    mountPreview({ src: null, source: 'manual' })
    expect(document.body.querySelector('.leaf-hover-preview')).not.toBeNull()
    expect(document.body.querySelector('.leaf-hover-preview img')).toBeNull()
    expect(document.body.querySelector('[data-hover-prov]')!.textContent).toContain('User entered')
  })

  it('renders nothing for a pure-OCR match with no screenshot', () => {
    mountPreview({ src: null, source: 'ocr' })
    expect(document.body.querySelector('.leaf-hover-preview')).toBeNull()
  })

  it('shows no provenance caption for a pure-OCR match with a screenshot', () => {
    mountPreview({ src: '/_screenshot/foo.png', source: 'ocr' })
    expect(document.body.querySelector('.leaf-hover-preview')).not.toBeNull()
    expect(document.body.querySelector('[data-hover-prov]')).toBeNull()
  })
})
