import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/vue'
import NoteProse from '@/components/coach/notes/NoteProse.vue'

// This component is the ONLY v-html in the app, so the escaping argument its
// header makes is worth holding to a test rather than to a comment.
describe('NoteProse', () => {
  it('renders a note as markup, not as literal markdown', () => {
    render(NoteProse, { props: { text: '**Hold the high ground**' } })
    expect(screen.getByText('Hold the high ground')).toBeInTheDocument()
    expect(screen.queryByText('**Hold the high ground**')).not.toBeInTheDocument()
  })

  it('renders a list as a list', () => {
    render(NoteProse, { props: { text: '- first\n- second' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('escapes a script tag in the note instead of executing it', () => {
    const raw = '<script>window.pwned = true</script>'
    const { container } = render(NoteProse, { props: { text: raw } })
    // Escaped means it survives as TEXT — the strongest positive statement of
    // the safety property, and one a TL query can make directly.
    expect(screen.getByText(raw)).toBeInTheDocument()
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the security claim is the ABSENCE of an element; no TL query expresses "nothing was parsed as markup"
    expect(container.querySelector('script')).toBeNull()
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined()
  })

  it('gives an image no way to carry an event handler', () => {
    // The tag vocabulary is fixed and attribute-free but `<ol start>`, so
    // there is no path from note text to an attribute at all.
    const raw = '<img src=x onerror="window.pwned = true">'
    const { container } = render(NoteProse, { props: { text: raw } })
    expect(screen.getByText(raw)).toBeInTheDocument()
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting no <img> was produced; absence has no TL query
    expect(container.querySelector('img')).toBeNull()
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined()
  })

  it('escapes through the same helper when a search term is being lit', () => {
    // The highlighting path is a second entrance to the same markup; a search
    // term must not be able to open what the note text cannot.
    const { container } = render(NoteProse, {
      props: { text: '<img src=x onerror="window.pwned = true"> positioning', highlight: ['positioning'] },
    })
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- same absence claim, through the highlighting entrance
    expect(container.querySelector('img')).toBeNull()
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined()
  })

  it('lights a search term that is present', () => {
    render(NoteProse, { props: { text: 'watch your positioning', highlight: ['positioning'] } })
    expect(screen.getByText('positioning')).toBeInTheDocument()
  })

  it('renders an empty note without throwing', () => {
    expect(() => render(NoteProse, { props: { text: '' } })).not.toThrow()
  })
})
