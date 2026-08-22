/**
 * Architectural rules the type system cannot state.
 *
 * WHY THIS EXISTS
 *
 * TECHNICAL_DEBT.md section 16 recorded a server read that lived outside the
 * query layer for months: `GetCoachingSettings` was called straight from two
 * components, so `SetCoachingSettings` had no cache key to invalidate and the
 * two surfaces agreed only by accident. Nothing could have caught it —
 * eslint sees one import, vue-tsc sees a well-typed call, and neither can
 * express "components do not talk to the server."
 *
 * dependency-cruiser can, because it reasons about the module graph and
 * distinguishes a type-only import from a value one. That distinction is the
 * whole trick here: a component importing `type MatchRecord` is fine and 116
 * files do it; a component importing the FUNCTION `GetCoachingSettings` is
 * the bug.
 *
 * Scope note: `src/client/` is the generated hey-api SDK and is never
 * hand-edited, so it is excluded rather than policed.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment:
        'A runtime import cycle makes module-evaluation order load-bearing, which is ' +
        'a bug that only shows up once someone reorders an import. Type-only cycles ' +
        'are erased before runtime and are allowed.',
      severity: 'error',
      from: {},
      to: { circular: true, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'no-orphans',
      comment:
        'A module nothing imports is dead weight (TECHNICAL_DEBT.md section 19). knip ' +
        'catches unused EXPORTS; this catches an entire file that fell out of the graph.',
      severity: 'error',
      from: {
        orphan: true,
        pathNot: ['(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$', '\\.d\\.ts$'],
      },
      to: {},
    },
    {
      name: 'components-no-server-values',
      comment:
        'Components render state; they do not fetch or mutate it. Server access belongs ' +
        'to src/queries (cached, invalidatable, on the shared error path) or to a ' +
        'composable that wraps it. Importing a TYPE from the api seam is fine — only ' +
        'value imports are forbidden. This is TECHNICAL_DEBT.md section 16 generalized ' +
        'to the rule that would have prevented it.',
      // WARN, not error, until the ten pre-existing callers are routed through
      // a composable or query -- TECHNICAL_DEBT.md section 16. Flip to 'error'
      // in the commit that clears the last one; a warning that outlives its
      // cleanup is exactly the toothless gate section 16 is a complaint about.
      severity: 'warn',
      from: { path: '^src/components/' },
      to: { path: '^src/api-client', dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^src/client/|\\.test\\.ts$|^src/test-utils/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.mjs', '.cjs', '.ts', '.vue'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
