# Changelog

## [0.2.1](https://github.com/sound-barrier/recall/compare/v0.2.0...v0.2.1) (2026-05-27)


### Bug Fixes

* **release:** create draft release first to dodge GitHub immutability race ([4606fb6](https://github.com/sound-barrier/recall/commit/4606fb6fdce0848bc7cb5c90ab71892bce3cdec3))

## [0.2.0](https://github.com/sound-barrier/recall/compare/v0.1.4...v0.2.0) (2026-05-27)


### ⚠ BREAKING CHANGES

* **api:** version under /api/v1/ and use REST-conventional verbs
* **db:** per-screenshot 3NF schema + read-time aggregation

### Features

* **data:** CSV export/import alongside JSON (auto-detect on import) ([5e2b48b](https://github.com/sound-barrier/recall/commit/5e2b48b663070b28a21a5549573d934bef6970c4))
* **data:** expose DB location + JSON export/import for backups ([42d03d2](https://github.com/sound-barrier/recall/commit/42d03d20091c5ccc1a625b9e03d6bb2c13513453))
* **db:** record screenshots-folder per parsed screenshot (3NF) ([2b4c0b4](https://github.com/sound-barrier/recall/commit/2b4c0b4a734a99a8b3516cc2fb99c5bada514fe3))
* **ingest:** live-stream matches + persistent parse-status footer ([5c8c32a](https://github.com/sound-barrier/recall/commit/5c8c32a2f921dbb82c1ff392a691e014096ab421))
* **matches:** aggregate-stats panel + active-filter pills + filtered-empty state ([aa18b46](https://github.com/sound-barrier/recall/commit/aa18b46a4ce85ae661afa926ddddcb902cfa414b))
* **matches:** compact-density toggle with inline E/A/D + damage ([70feb59](https://github.com/sound-barrier/recall/commit/70feb5962f1f346712fb1c120b5087d47a4ef483))
* **matches:** free-text note search in the FilterRail ([f527f27](https://github.com/sound-barrier/recall/commit/f527f27249fafbc1a426cd154266c399a2e9e2e7))
* **matches:** per-match leaver annotation + W/L/D handling preference ([20fb54d](https://github.com/sound-barrier/recall/commit/20fb54dbd02732f837cd2efb6e286b9042bbb407))
* **matches:** per-match notes, replay code, group members ([bdea028](https://github.com/sound-barrier/recall/commit/bdea0285c629f082058380fbe1c6fff2332dc805))
* **matches:** soft-delete (hide) matches with confirmation + unhide ([e153c19](https://github.com/sound-barrier/recall/commit/e153c19fee27f53f1dfb1f7a3f5611c952df382b))
* **matches:** user-defined match tags with quick-add + filter ([c6992c2](https://github.com/sound-barrier/recall/commit/c6992c2440a206fac8ff7327cff0cb6428a388e1))
* **owdata:** YAML source-of-truth for OW hero + map roster ([74cc3de](https://github.com/sound-barrier/recall/commit/74cc3defaebd0e67978c30d60bf1c91645f3fcfb))
* **settings:** auto-detect screenshots folder on first run ([5e03b66](https://github.com/sound-barrier/recall/commit/5e03b6665aff0151e528872aad31e4eb59d7856b))
* **settings:** RECALL_DATA_DIR env override for dev DB inspection ([6a913fe](https://github.com/sound-barrier/recall/commit/6a913fee553950d262c4da9f34862341da4d9135))
* **settings:** remove Open-folder buttons from Data Location rows ([aa45b09](https://github.com/sound-barrier/recall/commit/aa45b097ba3ac7c8ebfd18caa24e18228ae3684d))
* **settings:** UX pass — empty-state hero, swatch theme picker, compact calendar grid ([bf4268e](https://github.com/sound-barrier/recall/commit/bf4268e80482bb77c7214c900d35c169a068352b))


### Bug Fixes

* **a11y:** bump --text-mute + drop .min-play-or opacity for WCAG AA ([f463bc2](https://github.com/sound-barrier/recall/commit/f463bc2c554ddd0a43b6f1a0cb3df6e581153538))
* **api:** pass single struct arg to SetMatchAnnotation in Wails mode ([a6fbb95](https://github.com/sound-barrier/recall/commit/a6fbb9576e5d02224bc03e60bca234cdc1cf3312))
* **app:** one failing endpoint no longer fakes a "Tesseract not detected" banner ([1816d89](https://github.com/sound-barrier/recall/commit/1816d898e08c7c4d01ec488cbab596c6771801ee))
* **ci:** point schemathesis at /api/v1/ routes ([da5e98d](https://github.com/sound-barrier/recall/commit/da5e98d3e2524f48468f5cb5eb3f0245992c3814))
* close out all three TECHNICAL_DEBT.md items ([5029a8e](https://github.com/sound-barrier/recall/commit/5029a8ee3b98df27e2260c789e930891b9e989fb))
* **matches:** a11y role on annotation marks + hermetic RECALL_DATA_DIR for e2e ([e5e4872](https://github.com/sound-barrier/recall/commit/e5e4872296f6e64a21d8a5db5817d43972a173e0))
* **parse:** emit match-updated during OCR, not after ([4a2be81](https://github.com/sound-barrier/recall/commit/4a2be81b0849cfa46a6c6531ef1ea68d417488c3))
* **security:** quote parseErr in parse-failure log (CodeQL go/log-injection) ([dd30572](https://github.com/sound-barrier/recall/commit/dd30572ff374741c1aa7e3ec803644bf2d9f2cdb))
* **security:** sanitize log lines with user-controlled paths (CodeQL go/log-injection) ([6f6112f](https://github.com/sound-barrier/recall/commit/6f6112fe26825e2d2fe3486fc194aea684fa6754))
* **settings:** move shared Settings CSS out of scoped block ([38c028e](https://github.com/sound-barrier/recall/commit/38c028e0612f84cfaecd85d8ce369f436de5a8a2))
* **settings:** un-clip help tooltip + cap long path-value chips ([54da338](https://github.com/sound-barrier/recall/commit/54da338f98ba3035720c46e35602ef21a8590b61))
* **test:** allow .steam / .wine prefixes under HOME in probe test ([277563c](https://github.com/sound-barrier/recall/commit/277563c171ee1df1ec02441cb7a6d8e4a03a4541))
* **theme:** drop Settings-only Futura typeface override ([56f9989](https://github.com/sound-barrier/recall/commit/56f998982c7db32f75bfb13fdad5be10eb07e7ca))
* **theme:** page-wide opacity wash after first Settings visit ([80a2c66](https://github.com/sound-barrier/recall/commit/80a2c668443293e2b0d6ea947dcff2c472a9226a))
* **theme:** rebuild light palette to clear WCAG AA across surfaces ([eb7ae87](https://github.com/sound-barrier/recall/commit/eb7ae87c3f0ad37a1da5b3aa1481a8110346c154))


### Refactors

* **api:** collapse Wails-vs-fetch branching into _dualVoid helper ([404bf05](https://github.com/sound-barrier/recall/commit/404bf058afb4a6767366a64ec2b8902c752b65ae))
* **api:** version under /api/v1/ and use REST-conventional verbs ([239ca4e](https://github.com/sound-barrier/recall/commit/239ca4edf89ce1e7c0504e852e03dbefd2228845))
* **app:** extract backup/restore flow into useBackupRestore composable ([f2c1687](https://github.com/sound-barrier/recall/commit/f2c16879ae897167a3a1f3d6e4f10cec807d4d7b))
* **app:** extract clear-database flow into useClearDatabase composable ([4b58791](https://github.com/sound-barrier/recall/commit/4b587914d0842f51339089d8ad4e53da1085e133))
* **app:** extract feature toggle pattern into useFeatureToggle ([abfc735](https://github.com/sound-barrier/recall/commit/abfc7353173b9dfef23f96dde92a1637c7822d00))
* **app:** extract modal focus trap into useModalFocusTrap composable ([4e922ce](https://github.com/sound-barrier/recall/commit/4e922ce5d6d8810fd612f0df06b2021e0055081a))
* **app:** extract screenshots dir + probe into useScreenshotsDir ([4b0483e](https://github.com/sound-barrier/recall/commit/4b0483e4b1025166f3bd80020dfc5df745caa80b))
* **app:** extract SSE event subscriptions into useEventStream ([48ab518](https://github.com/sound-barrier/recall/commit/48ab5187119445f977e755aa5019f0548e278cfa))
* **app:** extract tab keyboard nav into useTabKeyboardNav composable ([3474c2a](https://github.com/sound-barrier/recall/commit/3474c2a10fb3a4dc88b885ee722b0e85423fb04b))
* **app:** extract Tesseract status into useTesseractStatus composable ([8b9bb9d](https://github.com/sound-barrier/recall/commit/8b9bb9d245a48477985e03022a04cfa300982a38))
* **composables:** collapse 7-way persisted-preference duplication into usePersistedRef ([5728ba6](https://github.com/sound-barrier/recall/commit/5728ba6a02faf7aa8eed6c8c6493c31dfef432d9))
* **db:** drop match_annotations migration plumbing — 0.2.0 is a clean cut ([1c35c59](https://github.com/sound-barrier/recall/commit/1c35c59f5a79c9b7b9a4de8d4a3f3ec1e8cf8a35))
* **db:** per-screenshot 3NF schema + read-time aggregation ([ecc4f2f](https://github.com/sound-barrier/recall/commit/ecc4f2f1832c00ecc7e17704c88092b5d652c0e8))
* **db:** split store.go into file-per-concern ([1328879](https://github.com/sound-barrier/recall/commit/13288798a49e72c6c68e1f91614c46941418dbca))
* **filter-rail:** extract MinPlayInput + LeaverSegmented sub-components ([f1810b5](https://github.com/sound-barrier/recall/commit/f1810b55b37e722613028f7e90c542bbdcde13cb))
* **match-card:** extract MatchCardDanger for the soft-delete row ([577a82a](https://github.com/sound-barrier/recall/commit/577a82a04d753624e4251991ee5742e50a280d21))
* **matches:** extract MatchCardExpanded (annotation + stats + sources) ([b956c29](https://github.com/sound-barrier/recall/commit/b956c29904aa1d2ecfb47e4cff305ce114cb04d2))
* **matches:** extract MatchCardHeader (collapsed view) ([dd7a155](https://github.com/sound-barrier/recall/commit/dd7a155c7ed7070f7b9d9a456ada2e0a73103a2c))
* **settings:** extract SettingsAdvanced panel (Grafana + Clear DB) ([a56d8dd](https://github.com/sound-barrier/recall/commit/a56d8ddfd2344a1f808f1446a06ec398ef319e9b))
* **settings:** extract SettingsAppearance panel (theme swatches) ([5010f8f](https://github.com/sound-barrier/recall/commit/5010f8fd4c4036be7502bb7659637bf89625c5b4))
* **settings:** extract SettingsBackupRestore panel ([c1d0aba](https://github.com/sound-barrier/recall/commit/c1d0aba1020b6bf7c2c8e5be045e41b8b3ace49b))
* **settings:** extract SettingsCalendar panel; downscope item [#5](https://github.com/sound-barrier/recall/issues/5) ([fe3076e](https://github.com/sound-barrier/recall/commit/fe3076eaa28f73ddde0361a6dd281e5ecc96bf0b))
* **settings:** extract SettingsEngine panel (Tesseract) ([07b42b4](https://github.com/sound-barrier/recall/commit/07b42b485f26a9a553d155c84d488bca4c5c8fd3))
* **settings:** extract SettingsFolders panel (Directories) ([7cef0eb](https://github.com/sound-barrier/recall/commit/7cef0eb92c725c697c6b5192d2e9adc1b942124b))
* **testing:** single dbtest.Fake replaces the two divergent fakeStores ([031b100](https://github.com/sound-barrier/recall/commit/031b100dcd56f3c3c6e047aa60d8a757f62aa1fb))
* **ui:** consolidate config in Settings; Parse tab does one job ([c09c48b](https://github.com/sound-barrier/recall/commit/c09c48b8913dae5dbcde27c0eeaabc48435c6ccc))


### Documentation

* add FEATURES.md feature backlog with triage workflow ([746c589](https://github.com/sound-barrier/recall/commit/746c589b3558fb9282032b0a659ce7c9e9f48f30))
* **api:** add operationId to every OpenAPI route ([e8adf23](https://github.com/sound-barrier/recall/commit/e8adf23bf0e5619d17a94bb0323f57fd02ac40cb))
* **app:** drop orphan TECHNICAL_DEBT.md [#1](https://github.com/sound-barrier/recall/issues/1) reference ([6e081b7](https://github.com/sound-barrier/recall/commit/6e081b7b5846be6089b43a191c2bda831a118d71))
* capture future Matches-view UX recommendations ([a49b7ce](https://github.com/sound-barrier/recall/commit/a49b7ce135d6a4a3df09acd1ba5c286c9aa165f2))
* **claude:** canonical REST API design guide ([f90c138](https://github.com/sound-barrier/recall/commit/f90c1388e2b18c325ca55760d37d0ee948231217))
* **claude:** fix stale references after API redesign ([97da36b](https://github.com/sound-barrier/recall/commit/97da36b7f0ecc06710266eea0635d55fc7637541))
* **claude:** pin three conventions surfaced by the match-deletion PR ([8fb943b](https://github.com/sound-barrier/recall/commit/8fb943bcc1c770f87eaa17009232f6f19ef03df5))
* **claude:** refresh stale rosters + surface e2e in make/composables sections ([bbf8df0](https://github.com/sound-barrier/recall/commit/bbf8df06d6e3cc7e875cdc426d2d0da6c454964f))
* **claude:** repair currency drift from per-screenshot-table refactor ([e774107](https://github.com/sound-barrier/recall/commit/e774107a9c320ba1d38a741b7a7011cd52e2bd23))
* **claude:** require failing Playwright e2e before any UI feature ([2f8a9c0](https://github.com/sound-barrier/recall/commit/2f8a9c0fa393fb80655080c1d2f85e0eae021de8))
* **claude:** tighten CLAUDE.md prose — drop ~22% of bytes, keep all rules ([6a86b88](https://github.com/sound-barrier/recall/commit/6a86b8892677d0e9eb9474a713923178dd232c24))
* **claude:** trim CLAUDE.md by ~36% via 6 targeted reductions ([64c53c2](https://github.com/sound-barrier/recall/commit/64c53c24adaeb301451d85c18f2575581626c4e1))
* **debt:** capture audit findings — 10 prioritized debt items ([2c999b2](https://github.com/sound-barrier/recall/commit/2c999b22f20fae49d8e4077475a11d7027260a3c))
* **debt:** delete paid-down SFC-extraction item ([71c5b3e](https://github.com/sound-barrier/recall/commit/71c5b3ed894785d48d793bd85bde1862e064325d))
* **features:** record what's shipped + expand the triaging backlog ([324fb2a](https://github.com/sound-barrier/recall/commit/324fb2a0d13b887cf1f884682c6f67e7767c4c26))
* Mei→Mizuki, Ingest→Parse, Windows-first landing page ([3897006](https://github.com/sound-barrier/recall/commit/3897006009dd2c8470ea5db4ef17d507115270fe))
* record three debt items accrued this session ([68c04b3](https://github.com/sound-barrier/recall/commit/68c04b3f5f7541dcb06cedef9287210e3f1b46c7))
* reflect the per-screenshot 3NF schema in user-facing copy ([f9db9dd](https://github.com/sound-barrier/recall/commit/f9db9dd6c0d7a303997fc511905c71b6a92073dc))
* rephrase to dodge typos false-positives on SELECT-s / SUMMARY-s ([b394404](https://github.com/sound-barrier/recall/commit/b394404876efbef11e4dc79c42dd625787348dd6))


### CI

* always report playwright + required-checkboxes contexts ([59778bd](https://github.com/sound-barrier/recall/commit/59778bdbd61ae9573c2ecf48db6c0e6b8cde58ff))
* **codeql:** switch to security-and-quality query suite ([bc9ca46](https://github.com/sound-barrier/recall/commit/bc9ca46bac04f6e855d309af87509b02394602ab))


### Tests

* **annotations:** migration rebuild + server e2e + member edge cases ([71a4c32](https://github.com/sound-barrier/recall/commit/71a4c3262b6f5ad9f34cbcca25de294b48fdc3aa))
* **data:** vitest coverage for export/import + data-location UI ([56dec0e](https://github.com/sound-barrier/recall/commit/56dec0ea438ba29710499e22961d3b112756e357))
* **frontend:** cover ParseProgressPanel + useOWData ([de49be3](https://github.com/sound-barrier/recall/commit/de49be3104d1eb16aa0f6a218f5a099faf3b0d93))
* **matches:** cover soft-delete end-to-end + fix 204 JSON-parse bug ([dd7f5b9](https://github.com/sound-barrier/recall/commit/dd7f5b9307cd519b352890e9bbce78787f555e08))
* **parser:** assert screenshot_type alongside MatchResult in goldens ([b41a504](https://github.com/sound-barrier/recall/commit/b41a504e4436b93fe896b363812a0ee939db5926))
* **parser:** pin scoreboard-geometry helpers with crafted image fixtures ([004a6b3](https://github.com/sound-barrier/recall/commit/004a6b3d9a745323a3a7ffa848e3805364a534d0))
* **parser:** project goldens onto per-screenshot-type shapes ([fd5d7a5](https://github.com/sound-barrier/recall/commit/fd5d7a58b71166d78ce408af40f15ec20339c179))

## [0.1.4](https://github.com/sound-barrier/recall/compare/v0.1.3...v0.1.4) (2026-05-25)


### Bug Fixes

* **ci:** release job needs actions/checkout to run extracted scripts ([eb9f117](https://github.com/sound-barrier/recall/commit/eb9f117566b14eea66c3be7a46bf532e45af826c))

## [0.1.3](https://github.com/sound-barrier/recall/compare/v0.1.2...v0.1.3) (2026-05-25)


### Bug Fixes

* **ci:** docker-build-env description must not contain ${{ }} syntax ([2f3db5f](https://github.com/sound-barrier/recall/commit/2f3db5fdbc40786efe687925105635029d50537d))


### Documentation

* **claude:** add nav block + split three paragraph-shaped bullets ([91566cd](https://github.com/sound-barrier/recall/commit/91566cd6be603ba001506b006e3f6ba27613ef94))

## [0.1.2](https://github.com/sound-barrier/recall/compare/v0.1.1...v0.1.2) (2026-05-25)


### Features

* **dev:** make Debian/Ubuntu a first-class wails dev host ([d9b8970](https://github.com/sound-barrier/recall/commit/d9b8970b34effccc717383fe66cd2cf464e427bf))


### Bug Fixes

* **a11y:** retire KNOWN_CONTRAST_DEBT — clear WCAG 2 AA on all views ([536a5e8](https://github.com/sound-barrier/recall/commit/536a5e82158136d7bd2c76fc99b2ab8de1f2a406))
* **app:** SetScreenshotsDir now restarts the watcher (server-mode parity) ([a408442](https://github.com/sound-barrier/recall/commit/a4084427dddfa33965cdb8646105f799f519e4c2))
* **ci:** add node types to vue-tsc scope ([c8f34a3](https://github.com/sound-barrier/recall/commit/c8f34a39aff5b8f44bb79921a645f7c10d77de23))
* **ci:** unbreak Docker builds + tool-versions env-file loading ([ccc24aa](https://github.com/sound-barrier/recall/commit/ccc24aa66f0b6448765f9b75829ea8eedc520fc4))


### Refactors

* **app:** split pkg/app/app.go into per-concern files ([5fa86cd](https://github.com/sound-barrier/recall/commit/5fa86cdcebdf52fa4fa46935918eb34833573025))
* **frontend:** extract App.vue style block into styles/app.css ([6794700](https://github.com/sound-barrier/recall/commit/6794700a804a3a5307a55007c8d82c3b6a5021b5))
* **frontend:** extract FilterRail CSS into scoped style block ([b27925c](https://github.com/sound-barrier/recall/commit/b27925c919fd3fb4bb639dfebaa986bc13531282))
* **frontend:** extract IngestView CSS into scoped style block ([1d7da16](https://github.com/sound-barrier/recall/commit/1d7da1643b85622199dcfe68775dc55efeee338b))
* **frontend:** extract MatchCard CSS into scoped style block ([c3bad4c](https://github.com/sound-barrier/recall/commit/c3bad4ce974ee7d58e45c59509871e28f47c14d7))
* **frontend:** extract MatchesView CSS into scoped style block ([460ea06](https://github.com/sound-barrier/recall/commit/460ea06dafaf4b7084001e95164347336ffddd7b))
* **frontend:** extract SettingsView CSS into scoped style block ([1fee7fe](https://github.com/sound-barrier/recall/commit/1fee7fead982ff9a27e2bd2f4dc3ea117a01e495))
* **frontend:** extract UnknownMapsView CSS; close TECHNICAL_DEBT [#1](https://github.com/sound-barrier/recall/issues/1) ([a07c947](https://github.com/sound-barrier/recall/commit/a07c94798ff122f8f9a1a646bdf6f54611a8718c))
* **parser:** split pkg/parser/parser.go into per-concern files ([a2d23b8](https://github.com/sound-barrier/recall/commit/a2d23b80c322984b27716ba1d006d606f50568b7))


### Documentation

* add TECHNICAL_DEBT.md inventory and remediation plan ([da68ca3](https://github.com/sound-barrier/recall/commit/da68ca3f9227df4d710eb9c24aad49d6d3fd0761))
* **book:** add how-it-works, settings, filtering, unknown chapters ([8016f11](https://github.com/sound-barrier/recall/commit/8016f1132ab9269d633285d51ba473b6868ad715))
* **book:** add Windows install + feedback chapter; add feature_request template ([d39e566](https://github.com/sound-barrier/recall/commit/d39e566a5ebe561b5e44c69843ebddd4a8e8e54e))
* **claude:** capture TECHNICAL_DEBT delete-policy + pre-push cover hook ([e2e4b68](https://github.com/sound-barrier/recall/commit/e2e4b68a74d8aaded3909b3a89dd2e094be29c1c))
* **claude:** note new check-wailsjs guard in struct-field bullet ([b4690e7](https://github.com/sound-barrier/recall/commit/b4690e7f58ff1c2232fbcc7cdd9f89b43f0b4274))
* **claude:** refresh stale file-path refs after pkg/app split ([5a111d2](https://github.com/sound-barrier/recall/commit/5a111d2993b17df2796a4a834b2f9d6d43fbc5a4))
* **debt:** honor the file's own delete-when-paid policy ([67b88cd](https://github.com/sound-barrier/recall/commit/67b88cd9bc2ad91f105a74d6b8b3cf154c9c064d))
* **debt:** rescope KNOWN_CONTRAST_DEBT item after deeper investigation ([5457555](https://github.com/sound-barrier/recall/commit/545755509e9530df632187f3afcf9ad8a5fe108c))
* embed testdata screenshots as visual examples in README + book ([50cd258](https://github.com/sound-barrier/recall/commit/50cd258f195901c64e792a9514a308483a6d0fb9))
* **releases:** document GHCR visibility-flip workaround; close [#10](https://github.com/sound-barrier/recall/issues/10) ([3a358ae](https://github.com/sound-barrier/recall/commit/3a358ae28edea48656a12415a0244aa824410a09))
* **testdata:** trim privacy/licensing paragraph ([731d378](https://github.com/sound-barrier/recall/commit/731d37826edfa49d3facc057178d53d5d80bc72b))


### CI

* add smoke-test harness for scripts/release/*.sh ([27453ce](https://github.com/sound-barrier/recall/commit/27453ce779f42b0617150ff7dd1f78fe221742dc))
* extract frontend/dist prep into a composite action ([8d673d8](https://github.com/sound-barrier/recall/commit/8d673d8985e4474a767e93cb89cff698129c176b))
* extract wails-build-env + docker-build-env composite actions ([30698b9](https://github.com/sound-barrier/recall/commit/30698b99ddcea7e2dab728dc59260e2b9a1cb7ec))
* **release:** extract release.yml shell bodies into scripts/release/ ([a8932ba](https://github.com/sound-barrier/recall/commit/a8932bad7f54610273908671f485fab0e18d6f2a))
* **security:** SHA-pin every third-party GitHub Action ([f33dbf9](https://github.com/sound-barrier/recall/commit/f33dbf9f5cb894356f0d4037058ac991ef633c24))
* **wails:** guard against wailsjs/models.ts drift from Go struct edits ([0e9dee5](https://github.com/sound-barrier/recall/commit/0e9dee502405db7bd6f4da359bc9329e49524cc6))


### Tests

* **app:** cite TestScreenshotType in screenshotType's ordering note ([37437fc](https://github.com/sound-barrier/recall/commit/37437fccd1656836660f4b4d3a7502048bebe053))
* **app:** lock read-time inference invariant with explicit tests ([7639019](https://github.com/sound-barrier/recall/commit/763901928d62ab94fc0ee90b895f1ccc000811c3))
* **parser:** commit 5 golden-file fixtures, close TECHNICAL_DEBT [#12](https://github.com/sound-barrier/recall/issues/12) ([764c88c](https://github.com/sound-barrier/recall/commit/764c88cac9cc839e5f7308aed7a73314637c6844))
* **parser:** wire golden-file fixtures + make update-goldens ([43adffe](https://github.com/sound-barrier/recall/commit/43adffe0b94697c73a18d6f13a464c0c1d7d3f50))

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
