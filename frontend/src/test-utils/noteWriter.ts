import { fireEvent, screen } from '@testing-library/vue'

/**
 * Switch a mounted NoteWriter to Markdown mode and hand back its textarea.
 *
 * Four suites need this, for two different reasons.
 *
 * The Formatted field is a contenteditable behind a dynamic import, so it is
 * neither present synchronously nor answerable by the matchers these tests
 * use: `toHaveValue` reads `.value` and throws on a div, and — the one that
 * actually bites — `toBeEnabled` passes VACUOUSLY on a div, so an assertion
 * about a blocked field would keep passing while meaning nothing.
 *
 * A test about how a component WIRES the writer up wants the raw field. A test
 * about the editor itself belongs in NoteWriter.test.ts, which pays for the
 * dynamic import because that is the thing it is testing.
 */
export async function markdownField(name = 'Note'): Promise<HTMLTextAreaElement> {
  await fireEvent.click(screen.getByRole('button', { name: 'Markdown' }))
  return screen.getByRole('textbox', { name }) as HTMLTextAreaElement
}

/**
 * Let a mounted NoteWriter's editor chunk resolve.
 *
 * A dynamic import is a real module load, so a microtask flush is not enough —
 * without this the field is simply absent and the failure reads as a missing
 * element rather than a slow one.
 */
export async function editorReady(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
}

/**
 * Leave the writer, the way a user does.
 *
 * A note commits when focus leaves the WRITER, not when it leaves the field —
 * the toolbar and the mode toggle are the writer's own chrome, and reaching for
 * Bold used to close the journal's editor before the press landed. So the event
 * that means "done" is `focusout`, which bubbles, and the check is deferred a
 * macrotask because a mousedown on a button does not focus it in every browser.
 * `fireEvent.blur` alone fires neither of those and commits nothing.
 */
export async function leaveWriter(field: HTMLElement): Promise<void> {
  await fireEvent.focusOut(field)
  await new Promise((r) => setTimeout(r, 0))
}
