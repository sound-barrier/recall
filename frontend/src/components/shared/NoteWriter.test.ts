import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from '@/stores/ui'
import { fireEvent, render, screen, within } from '@testing-library/vue'

import NoteWriter from '@/components/shared/NoteWriter.vue'
import { editorReady } from '@/test-utils'

// The note writing surface: two modes over one value, and one toolbar that
// serves both. The toolbar cases moved here from CoachNoteEditor's suite when
// the textarea became an editor — they were always about the writer, not about
// the card around it.

/**
 * Mount and let the editor's dynamic import resolve.
 *
 * NoteRichText is behind defineAsyncComponent so ProseMirror stays out of the
 * initial bundle, and a real module import needs more than a microtask flush —
 * a plain `await nextTick()` here finds nothing rendered and reads as a
 * mysteriously empty editor. `editorReady` waits for the field rather than
 * sleeping a fixed span, because how long a module load takes depends on the
 * machine and on whether the run is instrumented.
 */
async function writer(over: Partial<{
  text: string; disabled: boolean; toolsDisabled: boolean; disabledReason: string; expandable: boolean
}> = {}) {
  // The writer reads the UI store to mark the app inert while it is expanded,
  // which is how a component announces an app-level modal here.
  setActivePinia(createPinia())
  const view = render(NoteWriter, {
    props: { text: '', label: 'Note', placeholder: 'What did you see?', ...over },
  })
  await editorReady()
  return view
}

const field = () => screen.getByRole('textbox', { name: 'Note' })
const tool = (name: string) => screen.getByRole('button', { name })
const modeBtn = (name: 'Formatted' | 'Markdown') =>
  within(screen.getByRole('group', { name: 'Note format' })).getByRole('button', { name })

function lastText(view: Awaited<ReturnType<typeof writer>>): string {
  const events = view.emitted('update:text') as [string][] | undefined
  return events?.[events.length - 1]?.[0] ?? ''
}

async function toRaw(): Promise<HTMLTextAreaElement> {
  await fireEvent.click(modeBtn('Markdown'))
  return field() as HTMLTextAreaElement
}

describe('NoteWriter — what you land on', () => {
  it('opens formatted, and renders the markdown rather than showing it', async () => {
    await writer({ text: 'Hold **the angle**' })
    // The markers did their job and left — which is the whole feature.
    expect(within(field()).getByText('the angle').tagName).toBe('STRONG')
    expect(field()).not.toHaveTextContent('**')
    expect(modeBtn('Formatted')).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the stored text, exactly, in markdown mode', async () => {
    await writer({ text: 'Hold **the angle**' })
    expect(await toRaw()).toHaveValue('Hold **the angle**')
    expect(modeBtn('Markdown')).toHaveAttribute('aria-pressed', 'true')
  })

  // The choice belongs to the note you are looking at, not to the app: a
  // fresh mount is a fresh note, and the default is the one to land on.
  it('goes back to formatted on a new mount', async () => {
    const first = await writer({ text: 'a' })
    await fireEvent.click(modeBtn('Markdown'))
    expect(modeBtn('Markdown')).toHaveAttribute('aria-pressed', 'true')
    first.unmount()

    await writer({ text: 'a' })
    expect(modeBtn('Formatted')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('NoteWriter — the toolbar in markdown mode', () => {
  // Seeded through the prop, the way the room's store feeds it back; only the
  // SELECTION comes from the field. These are the cases that used to live in
  // CoachNoteEditor's suite, driving the same pure transforms.
  async function seeded(text: string) {
    const view = await writer({ text })
    const box = await toRaw()
    return { view, box }
  }

  it('wraps the selection in bold', async () => {
    const { view, box } = await seeded('hold the angle')
    box.setSelectionRange(5, 8)
    await fireEvent.click(tool('Bold'))
    expect(lastText(view)).toBe('hold **the** angle')
  })

  it('wraps the selection in italic', async () => {
    const { view, box } = await seeded('hold the angle')
    box.setSelectionRange(0, 4)
    await fireEvent.click(tool('Italic'))
    expect(lastText(view)).toBe('*hold* the angle')
  })

  it('wraps the selection in strikethrough', async () => {
    const { view, box } = await seeded('chase')
    box.setSelectionRange(0, 5)
    await fireEvent.click(tool('Strikethrough'))
    expect(lastText(view)).toBe('~~chase~~')
  })

  it('unwraps a mark that is already there', async () => {
    const { view, box } = await seeded('**hold** the angle')
    box.setSelectionRange(2, 6)
    await fireEvent.click(tool('Bold'))
    expect(lastText(view)).toBe('hold the angle')
  })

  it('prefixes the line for a title, and a second press takes it off', async () => {
    const { view, box } = await seeded('ult economy')
    box.setSelectionRange(0, 0)
    await fireEvent.click(tool('Title'))
    expect(lastText(view)).toBe('# ult economy')
  })

  it('replaces one line mark with another rather than stacking them', async () => {
    const { view, box } = await seeded('# ult economy')
    box.setSelectionRange(3, 3)
    await fireEvent.click(tool('Bulleted list'))
    expect(lastText(view)).toBe('- ult economy')
  })

  it('caps the field at what the server accepts', async () => {
    await writer()
    expect(await toRaw()).toHaveAttribute('maxlength', '4000')
  })

  it('refuses a formatting press that would push the note past the cap', async () => {
    const view = await writer({ text: 'x'.repeat(4000) })
    await toRaw()
    await fireEvent.click(tool('Bulleted list'))
    expect(view.emitted('update:text')).toBeUndefined()
  })
})

describe('NoteWriter — the toolbar in formatted mode', () => {
  it('arms bold at the cursor without touching the note', async () => {
    const view = await writer({ text: 'hold the angle' })
    await fireEvent.click(tool('Bold'))
    // Nothing is selected, so this sets a STORED mark: the next character
    // typed comes out bold, and the note itself does not change — which is
    // why no update is emitted, and why the toolbar has to report the state
    // from a transaction rather than from a document change.
    expect(tool('Bold')).toHaveAttribute('aria-pressed', 'true')
    expect(view.emitted('update:text')).toBeUndefined()
  })

  // The discoverability answer to a real problem: the ledger styles h3 and h4
  // identically, so Title and Subheading look the same on every surface. A
  // textarea could never say which one you are in; the editor can.
  it('says which block you are in, which a textarea never could', async () => {
    await writer({ text: '# Ult economy' })
    expect(tool('Title')).toHaveAttribute('aria-pressed', 'true')
    expect(tool('Subheading')).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports no pressed state at all in markdown mode', async () => {
    await writer({ text: '# Ult economy' })
    await toRaw()
    expect(tool('Title')).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('NoteWriter — when writing is refused', () => {
  it('turns the tools off without touching the field', async () => {
    await writer({ text: 'a', toolsDisabled: true, disabledReason: 'Nothing to add' })
    expect(tool('Bold')).toBeDisabled()
    expect(tool('Bulleted list')).toBeDisabled()
  })

  // Bold on an empty reviewed-only note used to write `****`, which reads as a
  // written note — the switch then disabled itself with "clear it first" and
  // there was no way back.
  it('emits nothing when a disabled tool is pressed', async () => {
    const view = await writer({ text: '', toolsDisabled: true })
    await fireEvent.click(tool('Bold'))
    expect(view.emitted('update:text')).toBeUndefined()
  })

  it('disables the raw field itself when writing is blocked', async () => {
    await writer({ text: 'a', disabled: true, disabledReason: 'A session is open' })
    expect(await toRaw()).toBeDisabled()
  })
})

describe('NoteWriter — the typing itself', () => {
  // macOS substitutes words as you type and shows a balloon over the field.
  // A note is prose, so the useful behavior is the opposite: underline what
  // looks wrong and never rewrite what someone actually typed.
  it('asks to be underlined, not corrected', async () => {
    await writer()
    const box = await toRaw()
    expect(box).toHaveAttribute('spellcheck', 'true')
    expect(box).toHaveAttribute('autocorrect', 'off')
  })
})

describe('NoteWriter — what counts as leaving', () => {
  // The journal swaps the writer away for a preview when editing ends, so what
  // "ends" means decides whether the toolbar is reachable at all: the field's
  // own blur fires the moment you press Bold, and forwarding it closed the
  // editor before the press landed.
  async function leave(view: Awaited<ReturnType<typeof writer>>) {
    await fireEvent.focusOut(field())
    await new Promise((r) => setTimeout(r, 0))
    return view.emitted('blur')
  }

  it('stays put when focus moves to its own toolbar', async () => {
    const view = await writer({ text: 'a' })
    tool('Bold').focus()
    expect(await leave(view)).toBeUndefined()
  })

  it('reports a blur when focus leaves the writer entirely', async () => {
    const view = await writer({ text: 'a' })
    document.body.focus()
    expect(await leave(view)).toHaveLength(1)
  })

})

describe('NoteWriter — the expanded writing surface', () => {
  it('offers no expand control unless the host asked for one', () => {
    // A two-line field in a form that is mostly pickers has nothing to gain
    // from a full-viewport surface.
    return writer().then(() => {
      expect(screen.queryByRole('button', { name: 'Expand Note' })).not.toBeInTheDocument()
    })
  })

  it('opens a labeled dialog holding the same field', async () => {
    await writer({ expandable: true, text: 'start' })
    await fireEvent.click(screen.getByRole('button', { name: 'Expand Note' }))
    const dialog = screen.getByRole('dialog', { name: 'Note' })
    expect(within(dialog).getByRole('textbox', { name: 'Note' })).toBeInTheDocument()
  })

  it('counts the words in the note', async () => {
    await writer({ expandable: true, text: 'one two three' })
    await fireEvent.click(screen.getByRole('button', { name: 'Expand Note' }))
    expect(screen.getByText('3 words')).toBeInTheDocument()
  })

  it('says "1 word" for a one-word note', async () => {
    await writer({ expandable: true, text: 'alone' })
    await fireEvent.click(screen.getByRole('button', { name: 'Expand Note' }))
    expect(screen.getByText('1 word')).toBeInTheDocument()
  })

  it('counts nothing as no words', async () => {
    await writer({ expandable: true, text: '   ' })
    await fireEvent.click(screen.getByRole('button', { name: 'Expand Note' }))
    expect(screen.getByText('0 words')).toBeInTheDocument()
  })

  it('marks the app inert while it is open, and lets go on close', async () => {
    // It teleports to <body>, so nothing underneath is an ancestor any more —
    // the host has to be told to go unreachable.
    await writer({ expandable: true })
    // AFTER writer(), which installs the Pinia the component is using.
    const ui = useUiStore()
    await fireEvent.click(screen.getByRole('button', { name: 'Expand Note' }))
    expect(ui.expandedWriterOpen).toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(ui.expandedWriterOpen).toBe(false)
  })

  it('tells the host to save when it collapses, without saying it was left', async () => {
    // Collapsing is not a blur: the writer is still open and still being
    // edited. A host that saves on blur would otherwise end a full-screen
    // writing session with nothing written down.
    const view = await writer({ expandable: true, text: 'written' })
    await fireEvent.click(screen.getByRole('button', { name: 'Expand Note' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(view.emitted('commit')).toHaveLength(1)
    expect(view.emitted('blur')).toBeUndefined()
  })

  it('shows the preview beside the source only in Markdown mode', async () => {
    // Formatted IS the preview; a second pane would be two views of one thing.
    await writer({ expandable: true, text: '**bold**' })
    await fireEvent.click(screen.getByRole('button', { name: 'Expand Note' }))
    expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument()

    await fireEvent.click(modeBtn('Markdown'))
    const preview = screen.getByRole('region', { name: 'Preview' })
    expect(within(preview).getByText('bold')).toBeInTheDocument()
  })

  // NOTE: the "no blur while expanded" guard is covered by the e2e
  // (note-expanded-writing.spec.ts, "survives a click on its own margin"),
  // not here. In a unit environment the focus trap has already put focus in
  // the field by the time the deferred focusout check runs, so the guard
  // never decides anything — a test here passes with the guard removed, and
  // a test that cannot fail for a real reason is worse than none.

  it('still reports a blur once it is back inline', async () => {
    // The guard is about the expanded state, not a blanket silence.
    const view = await writer({ expandable: true, text: 'written' })
    // focusout bubbles, so firing it on the field reaches the writer's own
    // handler. Nothing is focused on a fresh collapsed render, so the
    // handler's "is focus still inside me?" check answers no on its own.
    await fireEvent.focusOut(screen.getByRole('textbox', { name: 'Note' }))
    await new Promise((r) => setTimeout(r, 5))

    expect(view.emitted('blur')).toHaveLength(1)
  })

  it('lets the app go if it is torn down while expanded', async () => {
    // The host can vanish under it — the detail panel closes, the match is
    // deleted. A flag left true would inert the whole app with nothing open.
    const view = await writer({ expandable: true })
    const ui = useUiStore()
    await fireEvent.click(screen.getByRole('button', { name: 'Expand Note' }))
    expect(ui.expandedWriterOpen).toBe(true)

    view.unmount()
    expect(ui.expandedWriterOpen).toBe(false)
  })

  it('passes a host attribute through to its own element', async () => {
    // The root is a Teleport, which cannot receive fallthrough attributes —
    // hence inheritAttrs:false plus an explicit v-bind. Without it a host's
    // class or title silently vanishes.
    setActivePinia(createPinia())
    render(NoteWriter, {
      props: { text: '', label: 'Note', placeholder: 'x' },
      attrs: { title: 'from the host' },
    })
    await editorReady()
    expect(screen.getByTitle('from the host')).toBeInTheDocument()
  })
})
