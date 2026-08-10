// '@/test-utils' — the Testing Library harness barrel. Migrated unit
// tests import from HERE (not the per-file modules) so eslint-plugin-
// testing-library's utils-module detection ('test-utils') recognizes
// the file and its rules engage. The retiring @vue/test-utils twins
// (mountApp/mountWidget) are deliberately NOT re-exported — importing
// them keeps a file outside the Testing Library lint surface until its
// migration batch lands.
// (seedQuery is NOT re-exported: it statically imports @/queries/client,
// which would drag the app module graph into every barrel importer before
// a file's own hoisted vi.mock('@/api') could apply — import it from
// '@/test-utils/queryTestUtils' directly.)
export { renderApp, fireBackendEvent, mockedApi } from '@/test-utils/renderApp'
export type { MountOverrides } from '@/test-utils/renderApp'
export { renderWidget } from '@/test-utils/renderWidget'
export type { RenderWidgetOptions } from '@/test-utils/renderWidget'
export { flushPromises } from '@/test-utils/flush'
