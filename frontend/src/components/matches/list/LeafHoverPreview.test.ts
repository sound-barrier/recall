import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { render, screen } from '@testing-library/vue'

import type { MatchRecord } from '@/api'
import LeafHoverPreview from '@/components/matches/list/LeafHoverPreview.vue'

// The preview teleports to document.body as an aria-hidden DECORATIVE
// card (a hover thumbnail duplicating information available elsewhere),
// so its presence/collapse contract is invisible to role queries —
// structural checks go through body.querySelector deliberately. Text
// queries still reach the provenance badge copy.
/* eslint-disable testing-library/no-node-access -- aria-hidden decorative hover card; presence/collapse is invisible to accessible queries */

function renderPreview(props: { src?: string | null; source?: MatchRecord['source']; editedFields?: string[] }) {
  return render(LeafHoverPreview, { props: { x: 0, y: 0, src: null, ...props } })
}

const card = () => document.body.querySelector('.leaf-hover-preview')
const cardImg = () => document.body.querySelector<HTMLImageElement>('.leaf-hover-preview img')

describe('LeafHoverPreview', () => {
  it('renders the screenshot thumbnail when src is set', () => {
    renderPreview({ src: '/_screenshot/foo.png' })
    const img = cardImg()
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toContain('foo.png')
  })

  it('captions an edited match with the provenance badge', () => {
    renderPreview({ src: '/_screenshot/foo.png', source: 'ocr_edited', editedFields: ['data.map'] })
    expect(screen.getByText('Edited')).toBeInTheDocument()
  })

  it('shows the badge for a manual match even with no screenshot', () => {
    renderPreview({ src: null, source: 'manual' })
    expect(card()).not.toBeNull()
    expect(cardImg()).toBeNull()
    expect(screen.getByText('User entered')).toBeInTheDocument()
  })

  it('renders nothing for a pure-OCR match with no screenshot', () => {
    renderPreview({ src: null, source: 'ocr' })
    expect(card()).toBeNull()
  })

  it('shows no provenance caption for a pure-OCR match with a screenshot', () => {
    renderPreview({ src: '/_screenshot/foo.png', source: 'ocr' })
    expect(card()).not.toBeNull()
    expect(screen.queryByText('OCR')).not.toBeInTheDocument()
  })

  it('drops the thumbnail and collapses when the image fails to load', async () => {
    renderPreview({ src: '/_screenshot/vanished.png', source: 'ocr' })
    const img = cardImg()
    expect(img).not.toBeNull()
    img!.dispatchEvent(new Event('error'))
    await nextTick()
    // No broken image, and nothing else to show → the whole card is gone.
    expect(cardImg()).toBeNull()
    expect(card()).toBeNull()
  })

  it('keeps the provenance badge when an edited match image fails to load', async () => {
    renderPreview({ src: '/_screenshot/vanished.png', source: 'ocr_edited', editedFields: ['data.map'] })
    cardImg()!.dispatchEvent(new Event('error'))
    await nextTick()
    expect(cardImg()).toBeNull()
    // The card stays because the provenance badge still has something to show.
    expect(screen.getByText('Edited')).toBeInTheDocument()
  })
})
