# Changelog

## [0.1.0](https://github.com/sound-barrier/recall/compare/v0.1.1...v0.1.0) (2026-05-25)


### Features

* add `make cover` umbrella target ([1e1db8f](https://github.com/sound-barrier/recall/commit/1e1db8f06a0be8c4c79b275c176632d1cec4df5e))
* add test suites, typed API client, release automation, and CI gates ([51302fc](https://github.com/sound-barrier/recall/commit/51302fcd1524c91944504cf8d7180745411411e6))
* **ci:** add dead-code analysis via deadcode and knip ([e97add5](https://github.com/sound-barrier/recall/commit/e97add54c1c963bed823837cb72df9e2d83ff324))
* **ci:** add frontend JS/TS code coverage via Vitest + V8 ([855558a](https://github.com/sound-barrier/recall/commit/855558a265ef9f58d282ff7917c399eee0e7bfaa))
* **ci:** add Go coverage make target and CI job ([389c881](https://github.com/sound-barrier/recall/commit/389c88174a6834760536c9b35707299dd4576915))
* **devcontainer:** mirror Brewfile tooling on a Debian base ([00661af](https://github.com/sound-barrier/recall/commit/00661af90eb3922523d6ddb1a3ad4f0cef89fb45))
* **dev:** make Debian/Ubuntu a first-class wails dev host ([d9b8970](https://github.com/sound-barrier/recall/commit/d9b8970b34effccc717383fe66cd2cf464e427bf))
* **docs:** publish a Honkit documentation book alongside the API site ([5994dd7](https://github.com/sound-barrier/recall/commit/5994dd7a3a75f1e232c2b420a8a03e80adce6379))
* **docs:** publish OpenAPI spec via GitHub Pages + Swagger UI ([88cafd9](https://github.com/sound-barrier/recall/commit/88cafd948fe7eb004fbde735fa7508fbc5f6b5d7))
* enforce coverage thresholds in cover-go, vitest, and pre-push ([8ba34b8](https://github.com/sound-barrier/recall/commit/8ba34b839174a95a22a2763015c68858c81cc52c))
* **frontend:** "Undated" toggle in FilterRail (default off) ([2cc9c3a](https://github.com/sound-barrier/recall/commit/2cc9c3a64e6d01ce23c096a7b21bdc3f80f949e2))
* **frontend:** add &lt;main&gt; landmark and skip-to-content link ([aac8357](https://github.com/sound-barrier/recall/commit/aac8357c9becf74fd104cc3f474e062634f9e1a0))
* **frontend:** brandmark links to the GitHub repo ([e1b33cc](https://github.com/sound-barrier/recall/commit/e1b33cc5cef1db37363773989bb14d77122def7d))
* **frontend:** collapsible Month/Week/Day grouping with W/L/D tallies ([65e9733](https://github.com/sound-barrier/recall/commit/65e9733c9eab8601d8fe337b47f55c755e0370e0))
* **frontend:** minimum-play threshold filter (percent or minutes) ([9ce3c43](https://github.com/sound-barrier/recall/commit/9ce3c43dfe1c08aaa35e0b1784a403c6071dd2df))
* **frontend:** pick any day as first-day-of-week, spell out names ([2a4db9c](https://github.com/sound-barrier/recall/commit/2a4db9c08cad001c34cf22694c95e64a73f2fe56))
* **frontend:** pulse the scoreboard when watcher imports new records ([40b7e83](https://github.com/sound-barrier/recall/commit/40b7e83d42b4109e560137d494c15929007f5809))
* **frontend:** Settings → Calendar → First Day of Week (Sun/Mon) ([f4eb1dc](https://github.com/sound-barrier/recall/commit/f4eb1dcf99a1fd4ee80db90bbd9c42b1fbb05459))
* **frontend:** wire arrow/Home/End on the masthead tablist ([7d2cc6f](https://github.com/sound-barrier/recall/commit/7d2cc6f3fe5c935e03f2d38150a7d2ada9d778c7))
* **frontend:** Year level on top of the Month/Week/Day outline ([2fa2ba4](https://github.com/sound-barrier/recall/commit/2fa2ba447f4a37a0051d5426a45cfcc3faa25924))
* **github:** add issue + PR templates with CI-enforced attestations ([7b4b2b2](https://github.com/sound-barrier/recall/commit/7b4b2b261ae1f9589d197d39e8697f752dae3a29))
* **github:** declarative repo labels + sync workflow ([d3bfab5](https://github.com/sound-barrier/recall/commit/d3bfab5cbe35adb887114f1a124b1dc2910f7b6a))
* **lint:** add actionlint workflow linter + fix two pre-existing bugs ([0c87c5d](https://github.com/sound-barrier/recall/commit/0c87c5d326bbcc4de5fba51b66021974cfea848e))
* **lint:** add gosec Go SAST + fix 3 real findings it surfaced ([ae1f4c2](https://github.com/sound-barrier/recall/commit/ae1f4c2a170dd7cbf7085e400435709b6501ea35))
* **lint:** add markdownlint-cli2 (CI + lefthook + Makefile) ([59bce23](https://github.com/sound-barrier/recall/commit/59bce23963a033108c018fd945cf21da95855924))
* **lint:** add typos spell-checker (CI + lefthook + Makefile + tooling) ([7ab4c6b](https://github.com/sound-barrier/recall/commit/7ab4c6b72d8a09dc14c40c1fdeaabf88b78c4f23))
* **macos:** drop -arm64 suffix from .app, add Applications + README to DMG ([6c32396](https://github.com/sound-barrier/recall/commit/6c32396d127d23e48008a8a3c42cb017224de377))
* **make:** add pages-build and pages-preview for local docs preview ([5550218](https://github.com/sound-barrier/recall/commit/5550218f8335c1cb566b1774d28d9084ded9d891))
* **release:** sign container images with cosign keyless OIDC ([c0c182d](https://github.com/sound-barrier/recall/commit/c0c182d07bd659ea8254f23bb5d78296e8f3eb1d))
* **setup:** add initialize.sh for fresh-clone setup on macOS + Debian ([fff8ab5](https://github.com/sound-barrier/recall/commit/fff8ab5bb760057d0b7d8f7642d63f0284a971b2))
* surface match + per-screenshot parsed dates ([b1b7c36](https://github.com/sound-barrier/recall/commit/b1b7c36ff3bfe4d3fe53cd89872edaddd896e5a1))
* **test:** add Playwright browser E2E suite ([4d9f8ee](https://github.com/sound-barrier/recall/commit/4d9f8eef58ba3f4fd005f9fd0c5833bdea9e0a53))
* **ui:** display build version in masthead ([35a13f5](https://github.com/sound-barrier/recall/commit/35a13f5bb7746c3db8ec045ee3b63deaa84528c2))
* **ui:** gate parse on Tesseract version; warn on unsupported (&lt;5.x) ([9b93b9b](https://github.com/sound-barrier/recall/commit/9b93b9b5288d7e2ae67611fcfd36c140527d921e))
* **ui:** show confirmed up-to-date indicator alongside update badge ([0a48690](https://github.com/sound-barrier/recall/commit/0a486909e04ab117f8e0c9dabbe2636c0a6307ec))
* **ui:** show update badge when a newer release is available ([0a48690](https://github.com/sound-barrier/recall/commit/0a486909e04ab117f8e0c9dabbe2636c0a6307ec))


### Bug Fixes

* **a11y:** retire KNOWN_CONTRAST_DEBT — clear WCAG 2 AA on all views ([536a5e8](https://github.com/sound-barrier/recall/commit/536a5e82158136d7bd2c76fc99b2ab8de1f2a406))
* **api:** reject invalid screenshots dirs with 400, not 500 ([f4dd6a5](https://github.com/sound-barrier/recall/commit/f4dd6a59eb8a130a5b03e754ae3d2f6a4b4d1c3f))
* **api:** return [] for an empty GET /api/match-results, not null ([0258ae5](https://github.com/sound-barrier/recall/commit/0258ae597158dde0403628a94c053bcb413b983f))
* **app:** SetScreenshotsDir now restarts the watcher (server-mode parity) ([a408442](https://github.com/sound-barrier/recall/commit/a4084427dddfa33965cdb8646105f799f519e4c2))
* **ci:** bump gosec to v2.26.1 and run via go install, not docker ([d0c55c9](https://github.com/sound-barrier/recall/commit/d0c55c9004d899f044fa1d9f7ca22ac185bd5198))
* **ci:** opt schemathesis into OpenAPI 3.1 support ([f54c916](https://github.com/sound-barrier/recall/commit/f54c91662304dc9d0efb28d419ab6f9aa2ab5b37))
* **ci:** scope rolling container tags to stable releases only ([ac64566](https://github.com/sound-barrier/recall/commit/ac6456688fb2c10e83f281ccf822ec7a01df4452))
* **ci:** stub frontend/dist so gosec can load the main package ([5e87cda](https://github.com/sound-barrier/recall/commit/5e87cdab27cccf6f457bed30ca13a79cbf1ad8a7))
* **ci:** sync api.gen.d.ts with updated openapi.yaml description ([7f70c7e](https://github.com/sound-barrier/recall/commit/7f70c7ebfaa30c0330ef9cf4224116832a0c27e0))
* **ci:** unblock golangci-lint, schemathesis, and release-please ([d667245](https://github.com/sound-barrier/recall/commit/d6672454ab8028d55e41e7feb1b7fd947ea6ff22))
* **frontend:** add *.vue module shim for IDE TypeScript resolution ([b5b4fce](https://github.com/sound-barrier/recall/commit/b5b4fcefc8b156a0284c1b42da140cc3371b14a8))
* **frontend:** demote engine-version warning from alert to status ([0d77632](https://github.com/sound-barrier/recall/commit/0d776325f2ac4b455025864b6ec296b1ffa7ee4d))
* **frontend:** min-play threshold — clear, m+s split, mutex ([72ff046](https://github.com/sound-barrier/recall/commit/72ff0461edf0b7621aef159266a56cb250e50aae))
* **frontend:** promote click-only chips and inline links to buttons ([5213e94](https://github.com/sound-barrier/recall/commit/5213e94fca9d14328d22782279f4c6520cdf3103))
* **frontend:** regenerate wails bindings for parsed_at fields ([943ba22](https://github.com/sound-barrier/recall/commit/943ba22b387b169783626b0eaf9243b1da39d2c8))
* **frontend:** stylelint autofix on FilterRail and SettingsView ([5870743](https://github.com/sound-barrier/recall/commit/5870743402236a73e5487bf533f4f7d16058456b))
* **frontend:** surface dateless matches in an UNKNOWN DATE group ([b1c6cd4](https://github.com/sound-barrier/recall/commit/b1c6cd4a2fd2239bf164a68329ef83bc277bdf06))
* **frontend:** trap focus and handle Escape on unsupported-Tesseract modal ([d32f1fe](https://github.com/sound-barrier/recall/commit/d32f1fe6ddd27006a7c836a86a5917227814d657))
* **github:** quote hex color values in labels.yml ([5a85f92](https://github.com/sound-barrier/recall/commit/5a85f927383d982a03fd37bf2364cd7905589dd9))
* **pages:** build Honkit out of a staging dir, not book/ in place ([b30e4f6](https://github.com/sound-barrier/recall/commit/b30e4f693988887d38e7eb1029147932f1dc17ee))
* **pages:** run honkit from inside book/ so chapter paths resolve ([c252069](https://github.com/sound-barrier/recall/commit/c252069853281530cd774e1d997db178eb6d4212))
* **parser:** keep parsing other files after one screenshot fails ([6f069a1](https://github.com/sound-barrier/recall/commit/6f069a108d6cee1d5b05f44d66f7f777d978378f))
* **parser:** suppress Windows cmd.exe flash when invoking tesseract ([99444fd](https://github.com/sound-barrier/recall/commit/99444fd2c05d79d2027e94b6af3ab9850d57cf24))
* **pr-compliance:** exempt release-please PRs by branch-name prefix ([d07ee74](https://github.com/sound-barrier/recall/commit/d07ee741dd4b9bf867f2865cfd7addd219070c67))
* **security:** sanitize user-controlled paths into exec.Command / os.Stat ([1b220ea](https://github.com/sound-barrier/recall/commit/1b220ea47f21ab1d3480bc82fde84f17ebc501bf))
* **test:** exclude Playwright e2e specs from Vitest discovery ([fa551e0](https://github.com/sound-barrier/recall/commit/fa551e008ce43ecc648f176e8c117845758ca720))
* **ui:** show most-recent indicator for dev builds ([0a48690](https://github.com/sound-barrier/recall/commit/0a486909e04ab117f8e0c9dabbe2636c0a6307ec))


### Refactors

* **app:** collapse mergeMatchResult with a generic firstNonEmpty ([5e806d7](https://github.com/sound-barrier/recall/commit/5e806d74dfcafce9f13bde351f871cb5d636fecf))
* **app:** extract settings I/O, watcher events, server mux ([ca9c18c](https://github.com/sound-barrier/recall/commit/ca9c18c7449cd2ac03f48d1f40b09aef6c9598a0))
* **app:** split pkg/app/app.go into per-concern files ([5fa86cd](https://github.com/sound-barrier/recall/commit/5fa86cdcebdf52fa4fa46935918eb34833573025))
* **db:** extract Store interface, inject into App ([9fcc734](https://github.com/sound-barrier/recall/commit/9fcc734a8a78f9e139e44822196a0affd8da1138))
* **frontend:** dedupe month names, fix orphaned comment, reuse tallyWLD ([463c366](https://github.com/sound-barrier/recall/commit/463c36650242491fcc5260f902cf1095a0c64842))
* **frontend:** DRY Unknown Maps view state (Phase 4) ([5257616](https://github.com/sound-barrier/recall/commit/5257616fb0043fd482e3c06f1c12e5bd6dd2491d))
* **frontend:** extract App.vue style block into styles/app.css ([6794700](https://github.com/sound-barrier/recall/commit/6794700a804a3a5307a55007c8d82c3b6a5021b5))
* **frontend:** extract FilterRail component (Phase 3c) ([2c9c4cc](https://github.com/sound-barrier/recall/commit/2c9c4cc8e77878ea73fe8d3d56c58315b4425aba))
* **frontend:** extract FilterRail CSS into scoped style block ([b27925c](https://github.com/sound-barrier/recall/commit/b27925c919fd3fb4bb639dfebaa986bc13531282))
* **frontend:** extract formatHourMinute helper ([34de17a](https://github.com/sound-barrier/recall/commit/34de17ab0cbf27fbfd1d9795eb8426c18ab4852e))
* **frontend:** extract IngestView CSS into scoped style block ([1d7da16](https://github.com/sound-barrier/recall/commit/1d7da1643b85622199dcfe68775dc55efeee338b))
* **frontend:** extract IngestView.vue from App.vue ([eefe411](https://github.com/sound-barrier/recall/commit/eefe4115570f3af187aa2ae776a54ae1904a2f35))
* **frontend:** extract MatchCard component (Phase 3b) ([d8be066](https://github.com/sound-barrier/recall/commit/d8be066b583b227453478529990159bcefa0812f))
* **frontend:** extract MatchCard CSS into scoped style block ([c3bad4c](https://github.com/sound-barrier/recall/commit/c3bad4ce974ee7d58e45c59509871e28f47c14d7))
* **frontend:** extract MatchesView CSS into scoped style block ([460ea06](https://github.com/sound-barrier/recall/commit/460ea06dafaf4b7084001e95164347336ffddd7b))
* **frontend:** extract MatchesView.vue from App.vue ([3b2f53a](https://github.com/sound-barrier/recall/commit/3b2f53af203f0951f589ac8a07e66db887a1d86b))
* **frontend:** extract ParseProgressPanel component (Phase 3a) ([ce85e50](https://github.com/sound-barrier/recall/commit/ce85e50cb1216be0f379c2095be376be53e087ef))
* **frontend:** extract pure helpers from App.vue into match-helpers ([876bfba](https://github.com/sound-barrier/recall/commit/876bfba01d81a7f6017daf996248a03e2ce982ed))
* **frontend:** extract SettingsView CSS into scoped style block ([1fee7fe](https://github.com/sound-barrier/recall/commit/1fee7fead982ff9a27e2bd2f4dc3ea117a01e495))
* **frontend:** extract SettingsView.vue from App.vue ([1a230b3](https://github.com/sound-barrier/recall/commit/1a230b3770fe3c5290913b2944e4436734d9959e))
* **frontend:** extract UnknownMapsView CSS; close TECHNICAL_DEBT [#1](https://github.com/sound-barrier/recall/issues/1) ([a07c947](https://github.com/sound-barrier/recall/commit/a07c94798ff122f8f9a1a646bdf6f54611a8718c))
* **frontend:** extract UnknownMapsView.vue from App.vue ([2671003](https://github.com/sound-barrier/recall/commit/2671003e7489b121a020b90652020c7f431b60eb))
* **frontend:** extract useFilterPanel composable from App.vue ([f0caf66](https://github.com/sound-barrier/recall/commit/f0caf6622770eace69a5034ee3c80c088ae577bd))
* **frontend:** extract useMatchFilters composable (Phase 2c) ([3bb64ec](https://github.com/sound-barrier/recall/commit/3bb64ecb1c7b657bc06659ceaf8e14da6850d57d))
* **frontend:** extract useTheme composable from App.vue ([52d1eb5](https://github.com/sound-barrier/recall/commit/52d1eb55f97987a8ad6ec104f4008324997e151d))
* **frontend:** harden api.ts types and add fetch error class (Phase 5) ([37e45dd](https://github.com/sound-barrier/recall/commit/37e45dd6c256fee57d4aaa2a7c0b653a2c32aafd))
* **go:** drop decorative wrappers, reuse the union helper ([87c3eae](https://github.com/sound-barrier/recall/commit/87c3eaeef53665ce40ca6370e80382899b49c7bf))
* **go:** pin interface implementations with compile-time assertions ([e2a0d57](https://github.com/sound-barrier/recall/commit/e2a0d572c7726f0adf56b02a2d3eb75df1b7e298))
* **parser:** add OCR seam; extract parseTesseractVersion ([a7e8cd0](https://github.com/sound-barrier/recall/commit/a7e8cd080c6a7b9a85cb23da5a8122f7d2c1cf94))
* **parser:** split pkg/parser/parser.go into per-concern files ([a2d23b8](https://github.com/sound-barrier/recall/commit/a2d23b80c322984b27716ba1d006d606f50568b7))
* **server:** extract methodGuard for single-method routes ([70199b8](https://github.com/sound-barrier/recall/commit/70199b8d849cdba01134d524292ad1a32e0a4798))


### Documentation

* add CODE_OF_CONDUCT.md and link from README + CONTRIBUTING + CLAUDE ([d23722f](https://github.com/sound-barrier/recall/commit/d23722f4e9b6e5a7e720880ffedd353837430cd8))
* add SECURITY.md and route CoC reports through it ([dc8e97f](https://github.com/sound-barrier/recall/commit/dc8e97f5f40b422ce0353cc808e6872b0fe84e8d))
* add stable-vs-prerelease release flow table and mermaid diagram ([bdcb581](https://github.com/sound-barrier/recall/commit/bdcb581f01cc9e266ad36fde0998f9afe1aea4c3))
* add TECHNICAL_DEBT.md inventory and remediation plan ([da68ca3](https://github.com/sound-barrier/recall/commit/da68ca3f9227df4d710eb9c24aad49d6d3fd0761))
* audit user-facing docs for audience fit ([e627ba8](https://github.com/sound-barrier/recall/commit/e627ba8839707f7063bd791be8e9e22c1425c272))
* **claude:** add check-deps.sh to scripts table ([a9b3b83](https://github.com/sound-barrier/recall/commit/a9b3b832833969598eee46aeba03091fd35dd10b))
* **claude:** add cover-go target and update CI coverage job list ([aca9051](https://github.com/sound-barrier/recall/commit/aca905110d8ac4a95affa1999ffe1565af31dfd4))
* **claude:** add coverage target, knip, and CI numbering notes ([b035d64](https://github.com/sound-barrier/recall/commit/b035d64c973102a476917e52aeb01fd65297832f))
* **claude:** bound make check-deps scope and document Spectral 3-place pin ([8ccfbd1](https://github.com/sound-barrier/recall/commit/8ccfbd188ca48d2755ca3b7c65cdc64ca1d8287b))
* **claude:** capture check-deps, npm update distinction, TS 6 blocker ([eaf863f](https://github.com/sound-barrier/recall/commit/eaf863f550aee484218cdc9290e416cf760f890f))
* **claude:** capture httptest, URL-seam, and methodGuard patterns ([6312f8e](https://github.com/sound-barrier/recall/commit/6312f8e9c32dec2b2c49e9cfcbd0d489553cfefa))
* **claude:** capture session learnings on API conventions and tag rules ([df84ab4](https://github.com/sound-barrier/recall/commit/df84ab4719e8b1d1540bdd73957ae45653ffccc1))
* **claude:** capture TECHNICAL_DEBT delete-policy + pre-push cover hook ([e2e4b68](https://github.com/sound-barrier/recall/commit/e2e4b68a74d8aaded3909b3a89dd2e094be29c1c))
* **claude:** capture two-test-runner glob ownership + gosec version check ([bdab509](https://github.com/sound-barrier/recall/commit/bdab509cc3e6bbfa3ab67f6f2e5c4a5239528cb0))
* **claude:** codify code-style + TDD directives Claude follows by default ([9f24bf8](https://github.com/sound-barrier/recall/commit/9f24bf8c6a14bd7f0c58e0c5abe0ab8572e9c362))
* **claude:** correct docs/book split and capture Honkit silent-failure modes ([52a69c2](https://github.com/sound-barrier/recall/commit/52a69c22ae34ef4e7cd708cd9be453f317088250))
* **claude:** currency pass — bound methods, schema, bundle, test files ([1feac23](https://github.com/sound-barrier/recall/commit/1feac23191da19310dd3c71e70c4473801092c58))
* **claude:** document the four view extractions ([99f1203](https://github.com/sound-barrier/recall/commit/99f1203615188dffe3665c51f3d2673879507860))
* **claude:** document the macOS README.txt ↔ install-macos.md sync ([2acfcf6](https://github.com/sound-barrier/recall/commit/2acfcf6fdb2edb642d1a9a8d13592ec149f47f07))
* **claude:** fix stale "in JS" reference in Vue ref convention ([9d4c8b1](https://github.com/sound-barrier/recall/commit/9d4c8b19ce539f90d8e4db8fcea5a12724b6a9ba))
* **claude:** fix stale frontend, test, Unknown Maps, and CI descriptions ([ff1e646](https://github.com/sound-barrier/recall/commit/ff1e646c40278cc26507e559a93eaaaf69f3faf3))
* **claude:** list pages-build and pages-preview in the make table ([02140bc](https://github.com/sound-barrier/recall/commit/02140bc4e87fbe2840db1f6f3a81b0442356c0d9))
* **claude:** name PR-comment actions + stylelint autofix one-liner ([aacc84f](https://github.com/sound-barrier/recall/commit/aacc84f53f60640cf2d42591a551d06150098c49))
* **claude:** name the third deadcode-filter copy (CI workflow) ([56198b7](https://github.com/sound-barrier/recall/commit/56198b77f25eca1ec42b1329589f2d779674006c))
* **claude:** note new check-wailsjs guard in struct-field bullet ([b4690e7](https://github.com/sound-barrier/recall/commit/b4690e7f58ff1c2232fbcc7cdd9f89b43f0b4274))
* **claude:** note that pr-compliance.yml needs branch protection to gate ([0d2cb7b](https://github.com/sound-barrier/recall/commit/0d2cb7b5597b4f3eb53d2e4662587b63d4f9ebf5))
* **claude:** refresh bundle baseline and add a11y patterns anchor ([f7b027d](https://github.com/sound-barrier/recall/commit/f7b027df4eb79cd9e33afc5bb8304bbe76f91cab))
* **claude:** refresh cloc table row and document cloc-detail ([a821fea](https://github.com/sound-barrier/recall/commit/a821fea2dad48f49491aae0a713d3be7c5da3a12))
* **claude:** refresh stale file-path refs after pkg/app split ([5a111d2](https://github.com/sound-barrier/recall/commit/5a111d2993b17df2796a4a834b2f9d6d43fbc5a4))
* **claude:** update CLAUDE.md for TypeScript migration and CI notes ([9669f08](https://github.com/sound-barrier/recall/commit/9669f08fc754aa94e7fbd8982f1efa99ff579a4d))
* **contributing:** document gen-types pre-commit hook in hooks table ([52b50ce](https://github.com/sound-barrier/recall/commit/52b50ce3c1e1d8c1310480294e62ef2db4e591db))
* **contributing:** document pre-push hooks in git hooks section ([1368829](https://github.com/sound-barrier/recall/commit/1368829b773f791926b4c348084184ec95f9324d))
* **contributing:** expose make test/typecheck/gen-types; drop stale bits ([3767203](https://github.com/sound-barrier/recall/commit/3767203ecee997adec9c5b17b0854ae7430cabd8))
* **debt:** honor the file's own delete-when-paid policy ([67b88cd](https://github.com/sound-barrier/recall/commit/67b88cd9bc2ad91f105a74d6b8b3cf154c9c064d))
* **debt:** rescope KNOWN_CONTRAST_DEBT item after deeper investigation ([5457555](https://github.com/sound-barrier/recall/commit/545755509e9530df632187f3afcf9ad8a5fe108c))
* document path-validation behavior on settings endpoints ([633ba96](https://github.com/sound-barrier/recall/commit/633ba965333ba06ea460a99f5d16ef52ad853cf6))
* document Release-As trailer for cutting prereleases ([2cef080](https://github.com/sound-barrier/recall/commit/2cef0803d849929842128f70f1d8aa82d159fa0f))
* document Tesseract 5.x requirement and wailsjs struct-field pattern ([a18bee9](https://github.com/sound-barrier/recall/commit/a18bee976b4da2c995c78f6793eff16977850dab))
* extract server, Grafana, and advanced guides into docs/ ([7edab3b](https://github.com/sound-barrier/recall/commit/7edab3b622c48ab8ff2ad103bf3b637c1f54949c))
* **frontend:** drop "ISO-8601 weeks" copy from week-start description ([73c9646](https://github.com/sound-barrier/recall/commit/73c9646f083fb4707435ff4102a1f592cf55da77))
* link the new Honkit docs site from README and CLAUDE.md ([712b792](https://github.com/sound-barrier/recall/commit/712b792122721b786018c62ce3ca8741b7fdd107))
* **macos:** align install guide sections 2-3 with the in-DMG README.txt ([1517158](https://github.com/sound-barrier/recall/commit/1517158deb74201dbde071990d9ebd9a5b30ab15))
* **macos:** quote actual Gatekeeper warning text in approval steps ([1f3d5bf](https://github.com/sound-barrier/recall/commit/1f3d5bfe1de58af8d532816e0734ae0bb7e6aaf8))
* **macos:** sync install guide + CLAUDE.md to the new app/DMG layout ([df76528](https://github.com/sound-barrier/recall/commit/df765288f55b2ffcc69bff2df8600a82e30e750a))
* make Windows the primary install target; extract macOS/Linux guides ([911bfa4](https://github.com/sound-barrier/recall/commit/911bfa48d83f236c2ff4b3269e04fffe7c7150f8))
* move Docker deployment details to docs/docker.md ([af31ee5](https://github.com/sound-barrier/recall/commit/af31ee5ee707d93f389c8e5281176167a39cd7cb))
* **readme:** add CI, release, CodeQL, version, license, and Go badges ([6dfd086](https://github.com/sound-barrier/recall/commit/6dfd08694182cc29bf23e96c4ed22c9a5a2a3205))
* **readme:** add Pages, Vue, Docs, API, Code of Conduct badges ([149bbcc](https://github.com/sound-barrier/recall/commit/149bbcc586e2d91b3af3a83508709592df88cff8))
* **readme:** fix versioned filenames, persistent docker example, latest-tag note ([6597c42](https://github.com/sound-barrier/recall/commit/6597c4255d2b7976c9072306ba77ebee554f4160))
* reflect view-extraction reality + capture session gotchas ([3a180c9](https://github.com/sound-barrier/recall/commit/3a180c9399428323529695a6730c593cd4cf01d3))
* **releases:** document GHCR visibility-flip workaround; close [#10](https://github.com/sound-barrier/recall/issues/10) ([3a358ae](https://github.com/sound-barrier/recall/commit/3a358ae28edea48656a12415a0244aa824410a09))
* **release:** split release docs to RELEASES.md and add make shortcuts ([a7900fa](https://github.com/sound-barrier/recall/commit/a7900fa3034111d945337713a990cd65f4c1ec29))
* rename "Overwatch 2"/"OW2" back to "Overwatch"/"OW" ([0fc5f58](https://github.com/sound-barrier/recall/commit/0fc5f589839b74a21b1a5062cc81ab64d4df9774))
* require Linux kernel commit style for body and trailers ([0da4810](https://github.com/sound-barrier/recall/commit/0da4810f39ef00d874fe7738c90fb31376756e31))
* **scripts:** add quick-reference table to scripts/README.md ([fc362a7](https://github.com/sound-barrier/recall/commit/fc362a7a99103affceb9dd9e00706cc1c0660b52))
* **scripts:** add README.md documenting all helper scripts ([55b18a2](https://github.com/sound-barrier/recall/commit/55b18a2a2b5310393dcbbb73c5255f0998084eb0))
* surface the hosted Swagger UI in README and CLAUDE.md ([c7bf75f](https://github.com/sound-barrier/recall/commit/c7bf75f203f3cdeb4578ad884d0da7a27a4adf05))
* update CLAUDE.md ([bc2f713](https://github.com/sound-barrier/recall/commit/bc2f71327d73ed2d7a55a6aa47228e81d6a716d1))


### Build & Packaging

* **deps:** bump esbuild and vitest in /frontend ([a7de88b](https://github.com/sound-barrier/recall/commit/a7de88b0aa35dc1944e856c070f926e54dc1c3ee))
* **deps:** bump the actions group across 1 directory with 3 updates ([db03980](https://github.com/sound-barrier/recall/commit/db039805e17a528410c1f3a27b82ad5b2cd3ea8e))
* **devcontainer:** add shfmt and update toolchain comments ([bd1ded1](https://github.com/sound-barrier/recall/commit/bd1ded116befa3700a5fdba2b63468c8a731840d))
* **devcontainer:** bump hadolint, lefthook, and trivy versions ([9252725](https://github.com/sound-barrier/recall/commit/92527251498bb39c5661eb6cc8ef79a8e720d26e))
* fix eslint lefthook glob and update CONTRIBUTING for full TS ([e6ddf6d](https://github.com/sound-barrier/recall/commit/e6ddf6d5cc742092038056cf669229b8aaa1befa))
* **frontend:** add typescript-eslint for TS-aware linting ([399ee73](https://github.com/sound-barrier/recall/commit/399ee7321e2abfc9203afb3fda8ffec325b7cdd7))
* **frontend:** add vue-tsc and enable lang="ts" in App.vue ([c5e305d](https://github.com/sound-barrier/recall/commit/c5e305d2dc1bb7a92a5b9799941dea72b4a782c2))
* **frontend:** bump vue, htmlhint, and postcss-html minor versions ([09c4376](https://github.com/sound-barrier/recall/commit/09c437608c047936dbddc0ede3533a0e5d12a8f6))
* **frontend:** rename main.js and vite.config.js to TypeScript ([7b53de7](https://github.com/sound-barrier/recall/commit/7b53de72e4d3c437e6351cfded45370cb7eab38a))
* harden frontend npm ci against esbuild ETXTBSY race ([a8a4202](https://github.com/sound-barrier/recall/commit/a8a4202aaf3817ee11f5beafc43b99e6c3945e7d))
* **lint:** expand golangci-lint from 5 linters to 16 ([42a1d21](https://github.com/sound-barrier/recall/commit/42a1d21e40d7de9bb91564cf9113e247cab93843))
* **scripts:** add check-deps target to report outdated tool pins ([325b304](https://github.com/sound-barrier/recall/commit/325b30476308563d8f906ba7d4ad2b2147c50bb5))
* **scripts:** enforce shellcheck + shfmt on bash in scripts/ ([403df94](https://github.com/sound-barrier/recall/commit/403df94477c3e2bca833bf9762639fa92b6847ec))
* **windows:** add NSIS installer via Wails -nsis flag ([a1c3aec](https://github.com/sound-barrier/recall/commit/a1c3aec6663fc111f21f804d13638a747ef2f123))


### CI

* add smoke-test harness for scripts/release/*.sh ([27453ce](https://github.com/sound-barrier/recall/commit/27453ce779f42b0617150ff7dd1f78fe221742dc))
* build frontend before coverage-go (fix missing frontend/dist) ([659ed96](https://github.com/sound-barrier/recall/commit/659ed968932fbc666cdbad42685101b568d1fc8f))
* collapse PR test + coverage into one comment with delta vs main ([2900b8d](https://github.com/sound-barrier/recall/commit/2900b8d41736e137b04e9720e5d9e5436cd779c3))
* **dead-code:** build frontend before running deadcode ([8136f33](https://github.com/sound-barrier/recall/commit/8136f33ffed4a8c372fa349d4bc0c7b47c541ad6))
* **dependabot:** ignore major-version bumps in weekly grouped PRs ([04bfd35](https://github.com/sound-barrier/recall/commit/04bfd358bbe03bb5ae43673f5ede441dc52cfa55))
* enforce single CI-authored comment per PR ([7765d9c](https://github.com/sound-barrier/recall/commit/7765d9cda0301d8e9126c2bbbb3bf026545db61b))
* extract frontend/dist prep into a composite action ([8d673d8](https://github.com/sound-barrier/recall/commit/8d673d8985e4474a767e93cb89cff698129c176b))
* extract wails-build-env + docker-build-env composite actions ([30698b9](https://github.com/sound-barrier/recall/commit/30698b99ddcea7e2dab728dc59260e2b9a1cb7ec))
* fix stale match-helpers.js reference in comment ([f18eacf](https://github.com/sound-barrier/recall/commit/f18eacf1559809c6f88ba75a9ed6f2bf9327028d))
* **pages:** track devcontainer Node 26 instead of CI-only 22 ([894bd45](https://github.com/sound-barrier/recall/commit/894bd4578ef30dddb2d89c6431f276119dd4aee6))
* post unit-test results + coverage summary on PRs ([b6ed219](https://github.com/sound-barrier/recall/commit/b6ed2192d31a16619e0e62b3da32042b35040457))
* **release:** attest build provenance with GitHub Sigstore ([a2c28cb](https://github.com/sound-barrier/recall/commit/a2c28cb14df65aeb2b163f1260301842d55fae2a))
* **release:** attest sha256 checksum files; document verification chain ([171140c](https://github.com/sound-barrier/recall/commit/171140c67fc61d275d6235bb3240ae0208f318e1))
* **release:** extract release.yml shell bodies into scripts/release/ ([a8932ba](https://github.com/sound-barrier/recall/commit/a8932bad7f54610273908671f485fab0e18d6f2a))
* **release:** unblock release.yml when release-please created the tag ([49f9577](https://github.com/sound-barrier/recall/commit/49f9577d4e9af05504f70ed4fcc9d3f89b819d10))
* **schemathesis:** exclude /api/events from API fuzzing ([518f3b6](https://github.com/sound-barrier/recall/commit/518f3b6cbf5a5adf9f57de84160a625cdf7279d6))
* **security:** SHA-pin every third-party GitHub Action ([f33dbf9](https://github.com/sound-barrier/recall/commit/f33dbf9f5cb894356f0d4037058ac991ef633c24))
* sync deadcode known-good filter with Makefile and lefthook ([c210a31](https://github.com/sound-barrier/recall/commit/c210a31bbfad048bbb5456cf991959e4e4a6222b))
* **wails:** guard against wailsjs/models.ts drift from Go struct edits ([0e9dee5](https://github.com/sound-barrier/recall/commit/0e9dee502405db7bd6f4da359bc9329e49524cc6))


### Tests

* **a11y:** integrate axe-core via Playwright + baseline known debt ([3b60cc1](https://github.com/sound-barrier/recall/commit/3b60cc1c378fbd9c85c202ed9ae8b79f46144e1c))
* **app:** cite TestScreenshotType in screenshotType's ordering note ([37437fc](https://github.com/sound-barrier/recall/commit/37437fccd1656836660f4b4d3a7502048bebe053))
* **app:** cover pure merge orchestration helpers; enable -race ([11da182](https://github.com/sound-barrier/recall/commit/11da18272c500796e473d77a4173079323d056e0))
* **app:** cover ScreenshotHandler path-traversal guards via httptest ([f15a8b9](https://github.com/sound-barrier/recall/commit/f15a8b9f22cd8410227bcb75904b45563fb6f8ca))
* **app:** lock read-time inference invariant with explicit tests ([7639019](https://github.com/sound-barrier/recall/commit/763901928d62ab94fc0ee90b895f1ccc000811c3))
* **app:** mock GitHub via httptest, cover CheckForUpdate branches ([ce3732e](https://github.com/sound-barrier/recall/commit/ce3732e614bf2c881fc120f9115f9133cf758a8d))
* **frontend:** add @vue/test-utils plumbing + App.vue smoke tests ([6a0a69b](https://github.com/sound-barrier/recall/commit/6a0a69b2b0f5c496795e528539e4d2095076a28e))
* **frontend:** FilterRail smoke + behavior tests ([0f04c27](https://github.com/sound-barrier/recall/commit/0f04c2778ea8850053ea9dfda7dcc1595eafdc87))
* **frontend:** MatchCard rendering + interaction tests ([8d2966c](https://github.com/sound-barrier/recall/commit/8d2966c956c998707720f9571363780b73e4683f))
* **frontend:** MatchGroupSection recursive tree tests ([2c7867b](https://github.com/sound-barrier/recall/commit/2c7867b6cfca122abce68a1849e3da088d2eafe2))
* **metrics:** cover collector via stub Reader; extract newMux helper ([8afd907](https://github.com/sound-barrier/recall/commit/8afd907371ada758632ec01ab36942dd8ace04aa))
* **parser:** wire golden-file fixtures + make update-goldens ([43adffe](https://github.com/sound-barrier/recall/commit/43adffe0b94697c73a18d6f13a464c0c1d7d3f50))


### Chores

* cut v0.0.10-beta.0 ([b4211e8](https://github.com/sound-barrier/recall/commit/b4211e80abaa498442acf9f5db922ff9be83dee3))
* cut v0.0.11-beta.0 ([298a016](https://github.com/sound-barrier/recall/commit/298a0163c052597b478c1f9cf3c825903c379a42))
* cut v0.0.15 ([a3799c6](https://github.com/sound-barrier/recall/commit/a3799c6028dee7e679eaf2889bcbc08c5d679643))
* cut v0.0.9-beta.0 ([81cc3c8](https://github.com/sound-barrier/recall/commit/81cc3c8f69484f973b0c468b8e0d8c9810feebbf))
* cut v0.1.0 ([7e0e89c](https://github.com/sound-barrier/recall/commit/7e0e89c9a39b47938f719e664e686f7c5c1e511d))

## [0.1.1](https://github.com/sound-barrier/recall/compare/v0.1.0...v0.1.1) (2026-05-24)


### Features

* **github:** declarative repo labels + sync workflow ([6e31959](https://github.com/sound-barrier/recall/commit/6e31959a8d74b614f0e92eda33a0e5634ab57b60))
* **lint:** add actionlint workflow linter + fix two pre-existing bugs ([2772115](https://github.com/sound-barrier/recall/commit/2772115dc06429db0cea14887e866fe9dafa0d97))
* **lint:** add gosec Go SAST + fix 3 real findings it surfaced ([8fb7be3](https://github.com/sound-barrier/recall/commit/8fb7be338a34f898750ca2e8d63d7161d93c648b))
* **lint:** add markdownlint-cli2 (CI + lefthook + Makefile) ([7f8ff06](https://github.com/sound-barrier/recall/commit/7f8ff0692e535f7e6437b3617070172bc89808ff))
* **lint:** add typos spell-checker (CI + lefthook + Makefile + tooling) ([a648053](https://github.com/sound-barrier/recall/commit/a6480531da428698fed33612637a00e450f22618))
* **release:** sign container images with cosign keyless OIDC ([a00da13](https://github.com/sound-barrier/recall/commit/a00da13daf61fd83c8e574dfce50e2b55640953a))
* **test:** add Playwright browser E2E suite ([c94cf6f](https://github.com/sound-barrier/recall/commit/c94cf6fe5c9805d5bb061432f5cf614d9053a52a))


### Bug Fixes

* **ci:** bump gosec to v2.26.1 and run via go install, not docker ([5642557](https://github.com/sound-barrier/recall/commit/564255752c93f85689044a6b32439af61bdcbb93))
* **ci:** stub frontend/dist so gosec can load the main package ([a68285f](https://github.com/sound-barrier/recall/commit/a68285f5d67741dbcaca973563671389c7690262))
* **github:** quote hex color values in labels.yml ([295f655](https://github.com/sound-barrier/recall/commit/295f65587750bb06f3f26669102ce66e4db5daf4))
* **test:** exclude Playwright e2e specs from Vitest discovery ([da0765b](https://github.com/sound-barrier/recall/commit/da0765bc4b4ab6949cf84792601512979da105f2))


### Documentation

* add SECURITY.md and route CoC reports through it ([45b2ae5](https://github.com/sound-barrier/recall/commit/45b2ae5a9ef7dd299228e8aa59c1d3540e303171))
* **claude:** capture two-test-runner glob ownership + gosec version check ([9db8ebf](https://github.com/sound-barrier/recall/commit/9db8ebf1d5433474a4647db0b0d1c0074295eb11))
* **macos:** quote actual Gatekeeper warning text in approval steps ([339e942](https://github.com/sound-barrier/recall/commit/339e942514268ab41f52dacb8393f2bec890d910))


### Tests

* **a11y:** integrate axe-core via Playwright + baseline known debt ([0591888](https://github.com/sound-barrier/recall/commit/0591888f9c66bac9cf6962c86800fe0229f7c6ad))

## [0.1.0](https://github.com/sound-barrier/recall/compare/v0.0.17...v0.1.0) (2026-05-24)


### Features

* **docs:** publish a Honkit documentation book alongside the API site ([c362526](https://github.com/sound-barrier/recall/commit/c36252691c08aee9fbcb0a1b33cb37e73e712255))
* **docs:** publish OpenAPI spec via GitHub Pages + Swagger UI ([83f5dd5](https://github.com/sound-barrier/recall/commit/83f5dd50b83a0afd703ffd88ce7107daf8100902))
* **frontend:** add &lt;main&gt; landmark and skip-to-content link ([931dbf8](https://github.com/sound-barrier/recall/commit/931dbf8f0b756a621b9427bf8c446de692e7faa9))
* **frontend:** pulse the scoreboard when watcher imports new records ([94804d7](https://github.com/sound-barrier/recall/commit/94804d7b21e2d42883a03e529366c30dc9d4b013))
* **frontend:** wire arrow/Home/End on the masthead tablist ([b5b7bbb](https://github.com/sound-barrier/recall/commit/b5b7bbbfcfbfb542240397da9fed90ce92ad0499))
* **github:** add issue + PR templates with CI-enforced attestations ([b55449e](https://github.com/sound-barrier/recall/commit/b55449eb20e663af75e8887f4e62daead87545cf))
* **macos:** drop -arm64 suffix from .app, add Applications + README to DMG ([f81dfda](https://github.com/sound-barrier/recall/commit/f81dfdabc7b4f090b1783749ae7cbae1b78f8ba4))
* **make:** add pages-build and pages-preview for local docs preview ([dbd1e0c](https://github.com/sound-barrier/recall/commit/dbd1e0cf5a211f3a730dbba6ea90325a23143d89))
* **setup:** add initialize.sh for fresh-clone setup on macOS + Debian ([ff3bd9a](https://github.com/sound-barrier/recall/commit/ff3bd9ae334124c0abf7d592e9e20a150e862928))


### Bug Fixes

* **frontend:** demote engine-version warning from alert to status ([9ac2ac1](https://github.com/sound-barrier/recall/commit/9ac2ac19f89f44c2b15a95ba458e6f7163abb323))
* **frontend:** promote click-only chips and inline links to buttons ([7776482](https://github.com/sound-barrier/recall/commit/7776482d4068d7c94569a4645adb785209b30b96))
* **frontend:** regenerate wails bindings for parsed_at fields ([001f0f1](https://github.com/sound-barrier/recall/commit/001f0f1b4e807aa35ce6ecad5a0b6f3cbe0fa3a6))
* **frontend:** trap focus and handle Escape on unsupported-Tesseract modal ([081cae3](https://github.com/sound-barrier/recall/commit/081cae3491737160ce7e35924a88c095c3b0fd09))
* **pages:** build Honkit out of a staging dir, not book/ in place ([64dd2e8](https://github.com/sound-barrier/recall/commit/64dd2e8b5a812ebbf881f177d7ea865cc47e793c))
* **pages:** run honkit from inside book/ so chapter paths resolve ([5863536](https://github.com/sound-barrier/recall/commit/58635361f38eda2a131eb88fad553b967fc361b4))
* **pr-compliance:** exempt release-please PRs by branch-name prefix ([2ca15d6](https://github.com/sound-barrier/recall/commit/2ca15d638954d1b1e1cc1966e798af0f3ea5834c))


### Refactors

* **app:** collapse mergeMatchResult with a generic firstNonEmpty ([08bea82](https://github.com/sound-barrier/recall/commit/08bea8267cd104d247b1210e8ce3e0627651699c))
* **frontend:** dedupe month names, fix orphaned comment, reuse tallyWLD ([532cf50](https://github.com/sound-barrier/recall/commit/532cf502be9789193fa1b44c4d7b4648d0596c9e))
* **frontend:** extract formatHourMinute helper ([0ce27a0](https://github.com/sound-barrier/recall/commit/0ce27a008b3321bf8b89b068201d6e4b0cdc51d8))
* **go:** drop decorative wrappers, reuse the union helper ([2cb2d52](https://github.com/sound-barrier/recall/commit/2cb2d521afcd75a977176e750f05b083f25fe00f))
* **go:** pin interface implementations with compile-time assertions ([eba3d0a](https://github.com/sound-barrier/recall/commit/eba3d0a6810d70a243b01a6ca670bccb551b05e2))
* **server:** extract methodGuard for single-method routes ([fa5317f](https://github.com/sound-barrier/recall/commit/fa5317f63cd996e4c7247c01a1a81eb3ac4bd358))


### Documentation

* add CODE_OF_CONDUCT.md and link from README + CONTRIBUTING + CLAUDE ([d602aa8](https://github.com/sound-barrier/recall/commit/d602aa8301289606ccf592a7bc19b6be99258443))
* **claude:** bound make check-deps scope and document Spectral 3-place pin ([1bfff22](https://github.com/sound-barrier/recall/commit/1bfff226a087969ff7ac2220fb3159b7a5c6eb4f))
* **claude:** capture httptest, URL-seam, and methodGuard patterns ([207623b](https://github.com/sound-barrier/recall/commit/207623bc68252a8733f0b869bfb693223737576c))
* **claude:** correct docs/book split and capture Honkit silent-failure modes ([d0a3ba6](https://github.com/sound-barrier/recall/commit/d0a3ba6eeeedb97a3495860a18459b18f0efe894))
* **claude:** document the macOS README.txt ↔ install-macos.md sync ([6ad50b9](https://github.com/sound-barrier/recall/commit/6ad50b9b28182034fd8741675abc08a328aa2f69))
* **claude:** list pages-build and pages-preview in the make table ([9c34f57](https://github.com/sound-barrier/recall/commit/9c34f5792f3184647f66ed60ea25ebe2ab22e00c))
* **claude:** note that pr-compliance.yml needs branch protection to gate ([df6f551](https://github.com/sound-barrier/recall/commit/df6f551f5260a04edae06c7a8a5093f1f252c8ed))
* **claude:** refresh bundle baseline and add a11y patterns anchor ([115e2a2](https://github.com/sound-barrier/recall/commit/115e2a2445fd114147e5f3f10dd4b55e72d91220))
* **claude:** refresh cloc table row and document cloc-detail ([31b9004](https://github.com/sound-barrier/recall/commit/31b9004fb6b0da7f834dee48e47cf5385734b11c))
* link the new Honkit docs site from README and CLAUDE.md ([205792e](https://github.com/sound-barrier/recall/commit/205792ecb4de464aba09f6701cb89e7c879547e1))
* **macos:** align install guide sections 2-3 with the in-DMG README.txt ([b57d0b7](https://github.com/sound-barrier/recall/commit/b57d0b7d87e26dbeb53e7b4222903189643d7fca))
* **macos:** sync install guide + CLAUDE.md to the new app/DMG layout ([a8d68eb](https://github.com/sound-barrier/recall/commit/a8d68eb598566c4eaaa9a42082dbe9c8a991602f))
* **readme:** add Pages, Vue, Docs, API, Code of Conduct badges ([dc496a3](https://github.com/sound-barrier/recall/commit/dc496a33fe2ad1867e95164ae030b90fbfe3fa2b))
* surface the hosted Swagger UI in README and CLAUDE.md ([1930475](https://github.com/sound-barrier/recall/commit/19304756b18a1d7a4a4de9496a81959c369bf5da))


### CI

* **pages:** track devcontainer Node 26 instead of CI-only 22 ([ab90c8b](https://github.com/sound-barrier/recall/commit/ab90c8b2ded92ba9bdf0f40ca22fb10c3d99079d))


### Tests

* **app:** cover ScreenshotHandler path-traversal guards via httptest ([daac0a5](https://github.com/sound-barrier/recall/commit/daac0a502e08482a1207bab25d8131f1f8d4c3f2))
* **app:** mock GitHub via httptest, cover CheckForUpdate branches ([021431f](https://github.com/sound-barrier/recall/commit/021431f4d4270f96798c74a3dfd3d65193d75727))


### Chores

* cut v0.1.0 ([6797ee2](https://github.com/sound-barrier/recall/commit/6797ee246eb1833eb6faefaeb7ffd5b562446a31))

## [0.0.17](https://github.com/sound-barrier/recall/compare/v0.0.16...v0.0.17) (2026-05-24)


### Features

* add `make cover` umbrella target ([bc1c613](https://github.com/sound-barrier/recall/commit/bc1c613abe1aeb55863d34a4131c345067e558ce))
* **ci:** add frontend JS/TS code coverage via Vitest + V8 ([9f76af4](https://github.com/sound-barrier/recall/commit/9f76af4507c3bf48c13a4939e77bfeec2d3064a5))
* **ci:** add Go coverage make target and CI job ([645b0b0](https://github.com/sound-barrier/recall/commit/645b0b04ea00bad12a0849ce6194fe430e69043d))
* enforce coverage thresholds in cover-go, vitest, and pre-push ([12cb4d6](https://github.com/sound-barrier/recall/commit/12cb4d661869dae1ce4e02fa7210c2a11e2bd824))
* **frontend:** "Undated" toggle in FilterRail (default off) ([15425d6](https://github.com/sound-barrier/recall/commit/15425d6ef283d32eaef46a4583df63777769a9ed))
* **frontend:** brandmark links to the GitHub repo ([8ac20fd](https://github.com/sound-barrier/recall/commit/8ac20fdf931ab392acbba897e4d350a1f4683b75))
* **frontend:** collapsible Month/Week/Day grouping with W/L/D tallies ([9a012d4](https://github.com/sound-barrier/recall/commit/9a012d4c196b450a9a4b4b704ac757d6ce5ea1b7))
* **frontend:** minimum-play threshold filter (percent or minutes) ([93a8779](https://github.com/sound-barrier/recall/commit/93a87799f26350f4e967ff261aa916d40f1fc441))
* **frontend:** pick any day as first-day-of-week, spell out names ([7f1517e](https://github.com/sound-barrier/recall/commit/7f1517ec4d31e54c1b7feccf6ff1301a3411097d))
* **frontend:** Settings → Calendar → First Day of Week (Sun/Mon) ([401aaf2](https://github.com/sound-barrier/recall/commit/401aaf2e7e4b65bdd38e94fcf45dfd3b3eca936f))
* **frontend:** Year level on top of the Month/Week/Day outline ([c5ba275](https://github.com/sound-barrier/recall/commit/c5ba275798f6f39ffbaafc7ec6c9d014d3132e12))
* surface match + per-screenshot parsed dates ([a7ddddc](https://github.com/sound-barrier/recall/commit/a7ddddc7c8eec0f694498b4da381969e076dcbe3))


### Bug Fixes

* **frontend:** add *.vue module shim for IDE TypeScript resolution ([1c94181](https://github.com/sound-barrier/recall/commit/1c9418132f3c6c0fe6103274fec0b1a4abe70735))
* **frontend:** min-play threshold — clear, m+s split, mutex ([cf01e89](https://github.com/sound-barrier/recall/commit/cf01e899b0a0b0a169ddd9714c09af0f5dbc4290))
* **frontend:** stylelint autofix on FilterRail and SettingsView ([07f7320](https://github.com/sound-barrier/recall/commit/07f73203274125693b62126e20fd2f093197d21a))
* **frontend:** surface dateless matches in an UNKNOWN DATE group ([e079abb](https://github.com/sound-barrier/recall/commit/e079abb90fca49b9318d16713a6f4f30bb7fca7d))
* **parser:** keep parsing other files after one screenshot fails ([2967805](https://github.com/sound-barrier/recall/commit/29678057933667889acd6fc4536e335a62683b8e))
* **parser:** suppress Windows cmd.exe flash when invoking tesseract ([97f0717](https://github.com/sound-barrier/recall/commit/97f07174c64c8b0779fd71b72ae417ab68878ca8))


### Refactors

* **app:** extract settings I/O, watcher events, server mux ([be4cebb](https://github.com/sound-barrier/recall/commit/be4cebb9c01ba081871f5cca2f317cbe44b2b6b4))
* **db:** extract Store interface, inject into App ([64eaa3f](https://github.com/sound-barrier/recall/commit/64eaa3f9b5b719b6225edbc7172c9518f754f191))
* **frontend:** DRY Unknown Maps view state (Phase 4) ([73f176d](https://github.com/sound-barrier/recall/commit/73f176de666bc483c08e92a646088bdf69ae491b))
* **frontend:** extract FilterRail component (Phase 3c) ([349ed54](https://github.com/sound-barrier/recall/commit/349ed54f76e0396f1c4337fa7333ad9e165cb801))
* **frontend:** extract IngestView.vue from App.vue ([167f38a](https://github.com/sound-barrier/recall/commit/167f38a8f0be23d2c7e80338b6c3f4cc018a1a36))
* **frontend:** extract MatchCard component (Phase 3b) ([7b50969](https://github.com/sound-barrier/recall/commit/7b509698448045a75e442e402930cb3f35fa79be))
* **frontend:** extract MatchesView.vue from App.vue ([a7fd229](https://github.com/sound-barrier/recall/commit/a7fd22936762b533b020143be0b2e94f62f25434))
* **frontend:** extract ParseProgressPanel component (Phase 3a) ([54422c5](https://github.com/sound-barrier/recall/commit/54422c593b604c603b3181da3095e323527f7fee))
* **frontend:** extract pure helpers from App.vue into match-helpers ([388a01f](https://github.com/sound-barrier/recall/commit/388a01fa45de748ae765db7262cc069be3404beb))
* **frontend:** extract SettingsView.vue from App.vue ([ba088ea](https://github.com/sound-barrier/recall/commit/ba088eaf4de9bdc17dd9ee9674b42f32c95540df))
* **frontend:** extract UnknownMapsView.vue from App.vue ([485f25a](https://github.com/sound-barrier/recall/commit/485f25a81e104e93cc290f71952c3b74aca26b1a))
* **frontend:** extract useFilterPanel composable from App.vue ([08d1803](https://github.com/sound-barrier/recall/commit/08d1803fa8445fd7e328ae099651afce4df97ede))
* **frontend:** extract useMatchFilters composable (Phase 2c) ([559cc19](https://github.com/sound-barrier/recall/commit/559cc191b5beae15339e9a96232990a03a08f7df))
* **frontend:** extract useTheme composable from App.vue ([6e0431b](https://github.com/sound-barrier/recall/commit/6e0431bf096f08dd082ec3f2da5a8e8d9c16181c))
* **frontend:** harden api.ts types and add fetch error class (Phase 5) ([db1cac2](https://github.com/sound-barrier/recall/commit/db1cac2f8b07852190cafc8a3328070cce317ab9))
* **parser:** add OCR seam; extract parseTesseractVersion ([d898598](https://github.com/sound-barrier/recall/commit/d8985988f0a8f852c2db479cafa5d26899238dd5))


### Documentation

* **claude:** add cover-go target and update CI coverage job list ([bf28f6f](https://github.com/sound-barrier/recall/commit/bf28f6fef53414a95c4f24af05ce822730facf2e))
* **claude:** add coverage target, knip, and CI numbering notes ([584f7a2](https://github.com/sound-barrier/recall/commit/584f7a2dd1fcb812525b920cad910a764326e041))
* **claude:** codify code-style + TDD directives Claude follows by default ([91c2700](https://github.com/sound-barrier/recall/commit/91c27004469d35b6292cceef66783dff4cb8d9a8))
* **claude:** currency pass — bound methods, schema, bundle, test files ([b916a44](https://github.com/sound-barrier/recall/commit/b916a44197531aa745b1d93cfa35aa949eb5d88e))
* **claude:** document the four view extractions ([a0e67c9](https://github.com/sound-barrier/recall/commit/a0e67c99d5aa3a4d38e00ec1de9411eeccee9cba))
* **claude:** fix stale frontend, test, Unknown Maps, and CI descriptions ([7abe36e](https://github.com/sound-barrier/recall/commit/7abe36e6338d78bc64e5bdb428b3577e00cf74f6))
* **claude:** name PR-comment actions + stylelint autofix one-liner ([d00f229](https://github.com/sound-barrier/recall/commit/d00f229d62f3313c17cb7e07d72b64b53e31a00e))
* **claude:** name the third deadcode-filter copy (CI workflow) ([2e62121](https://github.com/sound-barrier/recall/commit/2e6212144044ac1108f01ea16f3b05a6f5daff82))
* **frontend:** drop "ISO-8601 weeks" copy from week-start description ([c7626d5](https://github.com/sound-barrier/recall/commit/c7626d55b47b52bdb5e64b3dd103896bb16ee027))
* reflect view-extraction reality + capture session gotchas ([da88cd9](https://github.com/sound-barrier/recall/commit/da88cd90974b181b1ccedc2afa6ca32f5ffd8422))


### CI

* build frontend before coverage-go (fix missing frontend/dist) ([b5b3f49](https://github.com/sound-barrier/recall/commit/b5b3f4965f955e378ee5b26bae0082d062f97d2b))
* collapse PR test + coverage into one comment with delta vs main ([989ea9f](https://github.com/sound-barrier/recall/commit/989ea9fac3ad7dfd25d81a4b3714e9e7f6a25d01))
* enforce single CI-authored comment per PR ([0681e9d](https://github.com/sound-barrier/recall/commit/0681e9d30ac8d31377c37f9b5d27814ef008cb8b))
* post unit-test results + coverage summary on PRs ([520f3ac](https://github.com/sound-barrier/recall/commit/520f3acb7cc8cefd959962019b77ec2102facd57))
* sync deadcode known-good filter with Makefile and lefthook ([29463c4](https://github.com/sound-barrier/recall/commit/29463c48bf267a26bd24cdd176e246fb487e2980))


### Tests

* **app:** cover pure merge orchestration helpers; enable -race ([9a86113](https://github.com/sound-barrier/recall/commit/9a86113f1ad9fcc161fc8c9fda528874875475af))
* **frontend:** add @vue/test-utils plumbing + App.vue smoke tests ([7f10cf2](https://github.com/sound-barrier/recall/commit/7f10cf2d9bfd6008d81f9cbe6d6fbac78ac0a8ae))
* **frontend:** FilterRail smoke + behavior tests ([93407cc](https://github.com/sound-barrier/recall/commit/93407cc149be429015b59e714ad44e1f875f7db8))
* **frontend:** MatchCard rendering + interaction tests ([15fb9d7](https://github.com/sound-barrier/recall/commit/15fb9d7007e220ea9718944fdf07d45108b977a9))
* **frontend:** MatchGroupSection recursive tree tests ([6be22ed](https://github.com/sound-barrier/recall/commit/6be22edcc8338a731713dd1c71352c42518898d7))
* **metrics:** cover collector via stub Reader; extract newMux helper ([609c34a](https://github.com/sound-barrier/recall/commit/609c34a58d19edee28ba8e18bc6ba6bf76b1b28e))

## [0.0.16](https://github.com/sound-barrier/recall/compare/v0.0.15...v0.0.16) (2026-05-20)


### Features

* **ci:** add dead-code analysis via deadcode and knip ([b3d2b6e](https://github.com/sound-barrier/recall/commit/b3d2b6eceef753f4c37f2753c0c4710de61ebee5))
* **ui:** gate parse on Tesseract version; warn on unsupported (&lt;5.x) ([1b45a7b](https://github.com/sound-barrier/recall/commit/1b45a7bb4b92cfe4ac77788e1f0e8eb58dc4eaa7))
* **ui:** show confirmed up-to-date indicator alongside update badge ([3cf6864](https://github.com/sound-barrier/recall/commit/3cf68644a2f352d260031126b92ffd06f609fcf5))
* **ui:** show update badge when a newer release is available ([3cf6864](https://github.com/sound-barrier/recall/commit/3cf68644a2f352d260031126b92ffd06f609fcf5))


### Bug Fixes

* **ci:** sync api.gen.d.ts with updated openapi.yaml description ([11f1e2d](https://github.com/sound-barrier/recall/commit/11f1e2db4b5b0d66b260a8d847d1ed7749f90688))
* **ui:** show most-recent indicator for dev builds ([3cf6864](https://github.com/sound-barrier/recall/commit/3cf68644a2f352d260031126b92ffd06f609fcf5))


### Documentation

* audit user-facing docs for audience fit ([0824cae](https://github.com/sound-barrier/recall/commit/0824cae46a3d546dc40a926bc63605e50ad7906b))
* **contributing:** document gen-types pre-commit hook in hooks table ([ee5d8f8](https://github.com/sound-barrier/recall/commit/ee5d8f83e4898fd2e64a359c18581e23601c2724))
* **contributing:** document pre-push hooks in git hooks section ([4cbf0a6](https://github.com/sound-barrier/recall/commit/4cbf0a6ab020c4049f14499c33645ee78994868c))
* document Tesseract 5.x requirement and wailsjs struct-field pattern ([3b0de75](https://github.com/sound-barrier/recall/commit/3b0de752daf46089697876f866fb1d98eaef2b72))
* extract server, Grafana, and advanced guides into docs/ ([7db4572](https://github.com/sound-barrier/recall/commit/7db4572cbab5869845883f147f61997a5741d386))
* make Windows the primary install target; extract macOS/Linux guides ([589b81c](https://github.com/sound-barrier/recall/commit/589b81c8bdd425d9d077ad0e1dc3d2d4a832f28b))
* move Docker deployment details to docs/docker.md ([60a54c2](https://github.com/sound-barrier/recall/commit/60a54c22f34e41443dc3a2c06f50b7df5b9dd4bc))
* **readme:** add CI, release, CodeQL, version, license, and Go badges ([cdfa033](https://github.com/sound-barrier/recall/commit/cdfa033a18988f4590f8f9f525a75e7272f46c98))
* **scripts:** add quick-reference table to scripts/README.md ([cebeafc](https://github.com/sound-barrier/recall/commit/cebeafc81dd13c1db1179312e531404081f45b5f))


### Build & Packaging

* **windows:** add NSIS installer via Wails -nsis flag ([ba6d51a](https://github.com/sound-barrier/recall/commit/ba6d51a0e98e72a1512d9c7fed311bad0918208a))


### CI

* **dead-code:** build frontend before running deadcode ([b9d8699](https://github.com/sound-barrier/recall/commit/b9d86997cc9c9a196bf2e2aed7df1bfb3e16cb66))
* **release:** attest build provenance with GitHub Sigstore ([3d9c031](https://github.com/sound-barrier/recall/commit/3d9c031a3417cdf4dbd4ce4b1e04261675f9b518))
* **release:** attest sha256 checksum files; document verification chain ([71d5da8](https://github.com/sound-barrier/recall/commit/71d5da85f46393ba5905e153351b4e678c720c6c))

## [0.0.15](https://github.com/sound-barrier/recall/compare/v0.0.14-beta.0...v0.0.15) (2026-05-20)


### Features

* **ui:** display build version in masthead ([0777bd0](https://github.com/sound-barrier/recall/commit/0777bd0aba74720928805c678f1915ec8cc07766))


### Chores

* cut v0.0.15 ([e2da599](https://github.com/sound-barrier/recall/commit/e2da599e124762baf03e59971817ec9d7f3e8c96))

## [0.0.14-beta.0](https://github.com/sound-barrier/recall/compare/v0.0.13-beta.0...v0.0.14-beta.0) (2026-05-20)


### Documentation

* **claude:** add check-deps.sh to scripts table ([dd64cfc](https://github.com/sound-barrier/recall/commit/dd64cfc98292116adf5f5deac8bcf71dfe0ce035))
* **claude:** capture check-deps, npm update distinction, TS 6 blocker ([c308f9e](https://github.com/sound-barrier/recall/commit/c308f9e90b92d7053665af9a5237b08f545c0162))
* **scripts:** add README.md documenting all helper scripts ([add9b08](https://github.com/sound-barrier/recall/commit/add9b086ca83824dc2b70eb82c082fe5a2d48c26))

## [0.0.13-beta.0](https://github.com/sound-barrier/recall/compare/v0.0.12-beta.0...v0.0.13-beta.0) (2026-05-20)


### Documentation

* **claude:** fix stale "in JS" reference in Vue ref convention ([79f9702](https://github.com/sound-barrier/recall/commit/79f97022fcb7dec9d68612a399f76190c97cca74))
* **claude:** update CLAUDE.md for TypeScript migration and CI notes ([bde3f18](https://github.com/sound-barrier/recall/commit/bde3f186e3e1045a23f9a6dd9309002f8e45bb00))
* **release:** split release docs to RELEASES.md and add make shortcuts ([e1b439b](https://github.com/sound-barrier/recall/commit/e1b439bd0d90a62e645b7445bd6ae41ba68d0ecf))
* update CLAUDE.md ([6f9d04a](https://github.com/sound-barrier/recall/commit/6f9d04ac6354a2f69e9a32ce5da51a0e5117be2b))


### Build & Packaging

* **deps:** bump esbuild and vitest in /frontend ([a05a9f3](https://github.com/sound-barrier/recall/commit/a05a9f3a3599ee1c2e1fc467f253a1bcc124c0e8))
* **deps:** bump the actions group across 1 directory with 3 updates ([5080d58](https://github.com/sound-barrier/recall/commit/5080d58b27a5f91c19eb39c2c79cc9c6bc51c3e0))
* **devcontainer:** add shfmt and update toolchain comments ([858bc2d](https://github.com/sound-barrier/recall/commit/858bc2d4dd4a5b83f83053847658ccf203aa6df3))
* **devcontainer:** bump hadolint, lefthook, and trivy versions ([5d7ad09](https://github.com/sound-barrier/recall/commit/5d7ad09cca36c2ea581e41f9e0c98f6d5dcbbb40))
* fix eslint lefthook glob and update CONTRIBUTING for full TS ([f3ecfd0](https://github.com/sound-barrier/recall/commit/f3ecfd04d41b55e8a9b0a15d7d38af7877c6953b))
* **frontend:** add typescript-eslint for TS-aware linting ([6f9fac2](https://github.com/sound-barrier/recall/commit/6f9fac230b794a613e518619effc723c8b0c0ca8))
* **frontend:** add vue-tsc and enable lang="ts" in App.vue ([18ef307](https://github.com/sound-barrier/recall/commit/18ef3079791ef50ddc18ed0cb61c5cce0881be36))
* **frontend:** bump vue, htmlhint, and postcss-html minor versions ([9f6dfb1](https://github.com/sound-barrier/recall/commit/9f6dfb11810207083a3de8445ff0398314c9f25b))
* **frontend:** rename main.js and vite.config.js to TypeScript ([8339593](https://github.com/sound-barrier/recall/commit/833959326fe1adb72a89e73664c4f74d4776fdc0))
* **lint:** expand golangci-lint from 5 linters to 16 ([b167e8a](https://github.com/sound-barrier/recall/commit/b167e8a00dfa9a83a3a75a78d34e284b37ef3be4))
* **scripts:** add check-deps target to report outdated tool pins ([db176d3](https://github.com/sound-barrier/recall/commit/db176d3bab045a9c1d265a16e0dd6836289b6e0b))
* **scripts:** enforce shellcheck + shfmt on bash in scripts/ ([8929d88](https://github.com/sound-barrier/recall/commit/8929d88947ff48a24c71e9a4225d7a72669aec63))


### CI

* **dependabot:** ignore major-version bumps in weekly grouped PRs ([85d7c1d](https://github.com/sound-barrier/recall/commit/85d7c1df76b31bdc32bdb8a707f95397e7dd8c47))
* fix stale match-helpers.js reference in comment ([be75f87](https://github.com/sound-barrier/recall/commit/be75f879eed3efcf09b3d4cd5e52af0aecbb0aff))

## [0.0.12-beta.0](https://github.com/sound-barrier/recall/compare/v0.0.11-beta.0...v0.0.12-beta.0) (2026-05-19)


### Build & Packaging

* harden frontend npm ci against esbuild ETXTBSY race ([3979e96](https://github.com/sound-barrier/recall/commit/3979e96c7eef5315b24c0f2b4419b416aedbc006))


### CI

* **release:** unblock release.yml when release-please created the tag ([d0dde68](https://github.com/sound-barrier/recall/commit/d0dde68e129246d422fdd6339186e1d2ebb4bdf5))

## [0.0.11-beta.0](https://github.com/sound-barrier/recall/compare/v0.0.10-beta.0...v0.0.11-beta.0) (2026-05-19)


### Bug Fixes

* **security:** sanitize user-controlled paths into exec.Command / os.Stat ([9cec3a1](https://github.com/sound-barrier/recall/commit/9cec3a116dd0366496de1ba097d135e7d0eada79))


### Documentation

* document path-validation behavior on settings endpoints ([95e1f79](https://github.com/sound-barrier/recall/commit/95e1f79c663fa8d607a26fb4c60c816c91edfc7b))


### Chores

* cut v0.0.11-beta.0 ([a828804](https://github.com/sound-barrier/recall/commit/a82880477ebc88e7d1d84cc2dd4bd119eb0481d8))

## [0.0.10-beta.0](https://github.com/sound-barrier/recall/compare/v0.0.8...v0.0.10-beta.0) (2026-05-19)


### Features

* add test suites, typed API client, release automation, and CI gates ([04b5e50](https://github.com/sound-barrier/recall/commit/04b5e507a2f17b9732fc7a930c4f3660c1b9f17b))
* **devcontainer:** mirror Brewfile tooling on a Debian base ([18b9a1b](https://github.com/sound-barrier/recall/commit/18b9a1b56ce1a34504c898d2a71765990f6709cf))


### Bug Fixes

* **api:** reject invalid screenshots dirs with 400, not 500 ([2a4f6c4](https://github.com/sound-barrier/recall/commit/2a4f6c474d39d52af6dbf9845dc6f13b08e62a71))
* **api:** return [] for an empty GET /api/match-results, not null ([1019e54](https://github.com/sound-barrier/recall/commit/1019e54b6c8b4585739cb35b9d63dfe494160077))
* **ci:** opt schemathesis into OpenAPI 3.1 support ([073e7b5](https://github.com/sound-barrier/recall/commit/073e7b509eecb729f75bb3b0e726a5cafb793f74))
* **ci:** scope rolling container tags to stable releases only ([766e52c](https://github.com/sound-barrier/recall/commit/766e52c1d2bb855d2b87749c94dd6a3361bb4f2a))
* **ci:** unblock golangci-lint, schemathesis, and release-please ([99a9d88](https://github.com/sound-barrier/recall/commit/99a9d8814c8f51ec975d27629036ae81c80708ef))


### Documentation

* add stable-vs-prerelease release flow table and mermaid diagram ([58d4e50](https://github.com/sound-barrier/recall/commit/58d4e50a00991012534345214710b30be1db0b01))
* **claude:** capture session learnings on API conventions and tag rules ([d5826b0](https://github.com/sound-barrier/recall/commit/d5826b02e2b94d5ab08c106cc041df5a08fa4b9e))
* **contributing:** expose make test/typecheck/gen-types; drop stale bits ([5299ea6](https://github.com/sound-barrier/recall/commit/5299ea6da6404f9c08ca51de38e48486a7d1fd81))
* document Release-As trailer for cutting prereleases ([eeecd9b](https://github.com/sound-barrier/recall/commit/eeecd9b313eaf5ad30fed82f0544fde44498ef9c))
* **readme:** fix versioned filenames, persistent docker example, latest-tag note ([ca7ac23](https://github.com/sound-barrier/recall/commit/ca7ac23579c12515c2485665da8cea412519c01a))
* rename "Overwatch 2"/"OW2" back to "Overwatch"/"OW" ([fac4da1](https://github.com/sound-barrier/recall/commit/fac4da171c31aba17b6b743ead873d5af2721d33))
* require Linux kernel commit style for body and trailers ([06cbeda](https://github.com/sound-barrier/recall/commit/06cbeda7b1bf9b8754e2d20028a9c04ec4468fa0))


### CI

* **schemathesis:** exclude /api/events from API fuzzing ([446eba8](https://github.com/sound-barrier/recall/commit/446eba8bf5686864730a6b636acbb1a8bfdce76f))


### Chores

* cut v0.0.10-beta.0 ([0d1d104](https://github.com/sound-barrier/recall/commit/0d1d104c4ec04f743d282546c86c9fcf3dc95489))
* cut v0.0.9-beta.0 ([dbb2bb1](https://github.com/sound-barrier/recall/commit/dbb2bb1f7ea89accfa4f69551312642848f2e310))
