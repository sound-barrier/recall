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
