export default {
  extends: ['stylelint-config-standard'],
  plugins: ['stylelint-declaration-strict-value'],
  overrides: [
    {
      files: ['**/*.vue'],
      customSyntax: 'postcss-html',
    },
    {
      // The palette and the scales are DEFINED here, so of course they
      // hold literals. Exempting the definition files is what lets the
      // rule be strict everywhere else.
      files: ['src/styles/tokens.css', 'src/styles/themes.css'],
      rules: { 'scale-unlimited/declaration-strict-value': null },
    },
    {
      // The theme picker renders swatches of the OTHER themes' colors
      // while you are inside the current one. Those literals cannot be
      // var() references — reading a token would show the active theme
      // four times over.
      files: ['src/components/settings/SettingsAppearance.vue'],
      rules: { 'scale-unlimited/declaration-strict-value': null },
    },
  ],
  rules: {
    'declaration-block-single-line-max-declarations': null,
    'no-descending-specificity': null,
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global', 'deep'] }],

    // Require a design token for the properties that had actually
    // drifted. This app declared --space-*, --type-* and motion tokens
    // and then never used them: 53 distinct rem font sizes, 5 radii,
    // 20+ durations and ~300 hardcoded palette colors accumulated
    // instead, along with the Day-theme contrast failures that came
    // from hand-picking hues per component. Nothing mechanical was
    // stopping that.
    //
    // Scoped to color, type, radius and motion — the axes with a real
    // scale behind them. Deliberately NOT padding/margin/gap: the
    // spacing scale covers the common cases but plenty of values here
    // are genuine optical adjustments (0.28rem, 0.45rem), and forcing
    // those into the ladder would trade real layout quality for a
    // lint-clean report.
    // `animation` / `animation-duration` are deliberately absent: keyframe
    // timings here are per-effect (a 1.2s pulse dot, a 4.5s skeleton
    // shimmer, a 900ms toast), not points on a UI-motion scale, and
    // forcing them onto one would be cargo-culting. `transition-duration`
    // IS enforced — that's the interaction-feel scale.
    'scale-unlimited/declaration-strict-value': [
      [
        '/color$/',
        'fill',
        'stroke',
        'font-size',
        'border-radius',
        'transition-duration',
      ],
      {
        // The plugin defaults BOTH `ignoreVariables` and `ignoreFunctions`
        // to true. `ignoreVariables` is the point of the rule — a bare
        // `var(--token)` is exactly what we want and stays on. But
        // `ignoreFunctions` passes any value shaped `…(…)`, and that is a
        // hole the width of the palette: `rgb(245 166 35 / 6%)`,
        // `rgba(0,0,0,.4)` and `linear-gradient(#111, #222)` were all
        // lint-clean while a bare `#fff` failed. ~50 raw literals hid in
        // there, two of them on properties this rule explicitly polices.
        // Turn it off and let `ignoreValues: ['/var\\(--/']` below be the
        // only way a function passes — which is the honest test anyway:
        // the value has to trace back to a token.
        ignoreFunctions: false,
        // A var() is the goal; keywords that carry no design decision
        // are fine as literals.
        ignoreKeywords: [
          'currentcolor', 'transparent', 'inherit', 'initial', 'unset',
          'none', 'auto', 'revert',
        ],
        ignoreValues: [
          // 0 and 50% are shapes, not scale points: a 50% radius is "a
          // circle", a 0 duration is "off".
          '0', '0s', '0ms', '50%', '100%',
          // Anything DERIVED from a token passes. The rule's real
          // requirement is "this value traces back to the palette or a
          // scale", and `color-mix(in srgb, var(--accent) 22%, …)`,
          // `rgb(var(--shadow-rgb) / 55%)` and gradients over
          // var(--surface-2) all satisfy it — the plugin just can't see
          // inside a function on its own.
          '/var\\(--/',
          // Display-scale type (≥1.8rem) is off the ladder ON PURPOSE — a
          // 2.55rem masthead wordmark and a 5rem empty-state glyph are
          // per-surface editorial choices, and the tokens.css comment says
          // so. Body type below that threshold is still enforced.
          '/^([2-9]|1\\.[89])(\\.\\d+)?rem$/',
          // em is relative to the element's own font-size — a deliberate
          // "slightly smaller than my parent" that no absolute token can
          // express. The [^r] matters: a bare `/em$/` also matches `rem`,
          // which silently exempts EVERY rem font-size and turns the whole
          // font-size rule into a no-op.
          '/[^r]em$/',
          // The reduced-motion kill switch in themes.css.
          '0.01ms',
          // A tint of the element's OWN color. `currentcolor` is already
          // an allowed keyword above, so a mix over it traces back to
          // whichever token set `color` — the same test `/var\(--/`
          // applies, one hop later. No token can express it: the whole
          // point is that `.probe-chip-close:hover` tints itself with
          // whatever the chip currently is. Anchored end to end so it
          // admits ONLY the self-tint idiom — `color-mix(in srgb,
          // currentcolor 12%, #ff0000)` still fails.
          '/^color-mix\\(\\s*in srgb\\s*,\\s*currentcolor\\s+[\\d.]+%\\s*,\\s*transparent\\s*\\)$/',
        ],
        disableFix: true,
        expandShorthand: true,
      },
    ],
  },
}
