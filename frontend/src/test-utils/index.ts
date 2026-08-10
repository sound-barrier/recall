// '@/test-utils' — the Testing Library harness barrel. Unit tests
// import from HERE (not the per-file modules) so eslint-plugin-
// testing-library's utils-module detection ('@/test-utils') recognizes
// the file and its rules engage.
// (seedQuery is NOT re-exported: it statically imports @/queries/client,
// which would drag the app module graph into every barrel importer before
// a file's own hoisted vi.mock('@/api') could apply — import it from
// '@/test-utils/queryTestUtils' directly.)
// (The MountOverrides / RenderWidgetOptions types stay exported from
// their source modules — import them there if a test ever needs one.)
export { renderApp, fireBackendEvent, mockedApi } from '@/test-utils/renderApp'
export { renderWidget } from '@/test-utils/renderWidget'
export { flushPromises } from '@/test-utils/flush'
