# Changelog

## [0.6.0](https://github.com/sound-barrier/recall/compare/v0.5.0...v0.6.0) (2026-06-03)


### ⚠ BREAKING CHANGES

* **dossier:** direct-manipulation edit mode + single-source-of-truth layout
* **matches:** per-match review-status tag + sidebar toggle

### Features

* **dossier:** "Matches reviewed" + "Days since last review" tiles ([93e0e6f](https://github.com/sound-barrier/recall/commit/93e0e6fb0da0e478cb71f4e4b1f5d238f853eb3a))
* **dossier:** "Most played roles" bar-graph breakdown ([5eac8ed](https://github.com/sound-barrier/recall/commit/5eac8ed00e026cf6a93be46771813ef6c1dbe265))
* **dossier:** "W / L / D since last review" KPI tile ([db868d8](https://github.com/sound-barrier/recall/commit/db868d86f0246a4f55b131cb70f5fb6fb197c8e8))
* **dossier:** 8 opt-in widgets (current/longest streak, hero pool, best winrate hero, map types, time/day of week, recent 5 matches) ([6198658](https://github.com/sound-barrier/recall/commit/619865897c3d30fd3b6a1bb28ddc9025e30dd2ca))
* **dossier:** drag-to-reorder dashboard widgets, incl. cross-row ([c447cf9](https://github.com/sound-barrier/recall/commit/c447cf9474a67a09402b3c917ad8185022dbfd92))
* **dossier:** edit-mode UX polish — pill toggle, banner, hover controls, undo toast ([c87e294](https://github.com/sound-barrier/recall/commit/c87e29413feb4a8c8b25972d4f71efcebb289f3a))
* **dossier:** hide/show dashboard widgets via "Edit dashboard" modal ([07a6ae3](https://github.com/sound-barrier/recall/commit/07a6ae352481826e4f65c9438400d577e5cc3e2a))
* **dossier:** live-reflow drag with ghost source + off-grid revert ([9b4fd6a](https://github.com/sound-barrier/recall/commit/9b4fd6a6a4f91aeb56aed325efa55348ffb2d777))
* **dossier:** surface "Reset" in the edit banner with two-step confirm ([2fc1e57](https://github.com/sound-barrier/recall/commit/2fc1e577bebf947066af29ed454e601442295cde))
* **matches:** anchor workflow — plainer copy, set/clear toast, right-click ([e7f6e24](https://github.com/sound-barrier/recall/commit/e7f6e2416aab45f0fe69578a9b1cc2d2dfea5b95))
* **matches:** per-match review-status tag + sidebar toggle ([93a9003](https://github.com/sound-barrier/recall/commit/93a90032bad993b9f97d2cf0c992a5eb7e12dbf4))
* **matches:** polish anchor workflow — clearer copy, list pin, jump-to ([fdaaafd](https://github.com/sound-barrier/recall/commit/fdaaafd995faaedcc8ec93e8c2de347f71069244))
* **matches:** reviewed-by filter + "since this match" anchor ([34917c9](https://github.com/sound-barrier/recall/commit/34917c9ab511c625590b9038e9198703e0b2be3a))
* **matches:** right-click "Hide match" — third context menu item ([192da97](https://github.com/sound-barrier/recall/commit/192da97206e616d906dacd575a113711bdf389da))


### Bug Fixes

* **dossier:** pack overflow rows, span breakdowns, lift AddTile out of grid ([2dece21](https://github.com/sound-barrier/recall/commit/2dece21c74f5a3fa20fb6c9f5edbd5873a6d67f9))
* **matches:** rename "Unreviewed" → "Not reviewed", drop ✓ from default ([5633376](https://github.com/sound-barrier/recall/commit/5633376c5bebd671f0e113fba8f5bb0321ef315e))


### Refactors

* **dossier:** direct-manipulation edit mode + single-source-of-truth layout ([42b3b41](https://github.com/sound-barrier/recall/commit/42b3b41e6bea60c9574f55a13ca3cbaeb0f34850))
* **dossier:** registry-driven dashboard widgets (Phase 1 of 3) ([3e4850f](https://github.com/sound-barrier/recall/commit/3e4850f0f7f45a396766574fd9e7d0d0c63b5ca5))


### Documentation

* **contributing:** flesh out the Windows-via-WSL2 dev section ([194ac63](https://github.com/sound-barrier/recall/commit/194ac63e8af18bc4f9a7c896f94fa89aa2f24889))
* **contributing:** per-OS Dev Container notes + VS Code WSL workflow ([3595101](https://github.com/sound-barrier/recall/commit/35951010c19c2b3de1281c6d010cde4779122f85))


### CI

* GOTOOLCHAIN=auto in Dockerfile.build go-base stage ([27fed47](https://github.com/sound-barrier/recall/commit/27fed4770fd9c7754dc511cdeed85b204d5076c3))
* pin Dockerfile.build go-base 1.26 → 1.26.4 ([e5cc602](https://github.com/sound-barrier/recall/commit/e5cc602c6fa60d5cff98ba85d531d7ec0e25ca52))
* pin go-version 1.26 → 1.26.4 to match go.mod directive ([33cf048](https://github.com/sound-barrier/recall/commit/33cf0487e27ecab10b3d88224fb50ac4b644715a))
* switch go-base 1.26-bookworm → 1.26.4-trixie ([1068929](https://github.com/sound-barrier/recall/commit/106892932c515fc8cf560c1d12ce10f3403771f5))

## [0.5.0](https://github.com/sound-barrier/recall/compare/v0.4.0...v0.5.0) (2026-06-02)


### ⚠ BREAKING CHANGES

* OWMETRICS_DEBUG_DIR and OWMETRICS_METRICS_ADDR are no longer read. Use RECALL_DEBUG_DIR and RECALL_METRICS_ADDR.
* **card-state:** CardStateApi.previewOpen / previewError are gone. Use isPreviewOpen(filename) and hasPreviewError(filename) instead.
* **match-key:** the match_key format moved from `match:<ISO-with-colons>` / `unmatched:<filename>` / `ambiguous:<filename>` to `match-<ISO-with-dashes>` / `unmatched-<filename>` / `ambiguous-<filename>`. Old clients that hard-coded the colon shape stop working.
* **screenshots:** the URL shape for serving screenshot bytes changed from `/_screenshot/<filename>` to `/_screenshot/<dir-id>/<filename>`. Old URLs return 404.

### Features

* **db:** introduce SQLite migrations framework ([88ba528](https://github.com/sound-barrier/recall/commit/88ba528aa4323a42b81fe025930ab1160653be2a))
* **export:** compressed selection-aware bundle for backups + bug reports ([da5411f](https://github.com/sound-barrier/recall/commit/da5411f66937b93c28bf282a3eb4b9f46a938c48))
* **match-key:** URL-safe format — colon swapped for dash ([67110cf](https://github.com/sound-barrier/recall/commit/67110cf346c4c8bff3e45d2fe72ffbbebf51e288))
* **screenshots:** embed dir-id in screenshot URLs ([f5ce233](https://github.com/sound-barrier/recall/commit/f5ce23304517fc13f23ac1f4ee2606a8bfbbabb5))


### Bug Fixes

* **api:** boundary-validate setters, enable positive_data_acceptance ([8743eac](https://github.com/sound-barrier/recall/commit/8743eac6bf778dc8e62ada1f9ed8a429578a0e30))
* **api:** explicit 405 stubs for transfers/active path collisions ([ad0fe11](https://github.com/sound-barrier/recall/commit/ad0fe11fcd9e759d99d8935d3ba5c590b6345e12))
* **export:** non-1980 ZIP timestamps + drop screenshots_dirs leak; add bug-finder ([4e43fdd](https://github.com/sound-barrier/recall/commit/4e43fddbd7e49217c917bc216f433310989e2f2c))
* **first-run:** gate modal on active profile name, not just localStorage ([05b4bd3](https://github.com/sound-barrier/recall/commit/05b4bd31d65dab65e4ef0d3193f91371d5eebfa4))
* **matches:** j/k nav walks rendered order, not narrowedRecords ([50e8e92](https://github.com/sound-barrier/recall/commit/50e8e9283e8692481789bd12a49f3540cafcb8a1))
* **matches:** wire narrow search → matchQuery, re-arm note hit highlight ([9dec35b](https://github.com/sound-barrier/recall/commit/9dec35bb30bf1ad3a27782fd9bb7a987d01d484a))


### Refactors

* **card-state:** replace ref-bearing fields with getter functions ([c296b33](https://github.com/sound-barrier/recall/commit/c296b333401dc256f8fde3c0cf976141a07b5a12))
* **export:** dispatch import on schema version, add v1 fixture ([69ae6ff](https://github.com/sound-barrier/recall/commit/69ae6ff57be5d93ba26bdc1a58f4a58fa80db7df))
* **frontend:** consolidate preview state behind useScreenshotPreview ([63ec2fb](https://github.com/sound-barrier/recall/commit/63ec2fbb446a883e76f51e5a3038dbaaeb348eb3))
* **loading:** rename loading→parseBusy, initialLoading→firstLoadPending ([945a658](https://github.com/sound-barrier/recall/commit/945a6584be6ce7e1c245db6e9b61eefebb4ebb35))
* **matches:** extract useArchiveSelection composable ([945b3e6](https://github.com/sound-barrier/recall/commit/945b3e6131174a5f76a21bd34ad8d9624e94ad03))
* **onboarding:** extract storage key constant to its own module ([d2966ea](https://github.com/sound-barrier/recall/commit/d2966ea445d176502cd511a98b1f19679aee0cb0))
* rename OWMETRICS_* env vars to RECALL_* ([7afd4b4](https://github.com/sound-barrier/recall/commit/7afd4b420d55393e1fdc86a4fc6eca129839cb31))


### Documentation

* **bug-template:** encourage Export bundle attachments on bug reports ([b488f3b](https://github.com/sound-barrier/recall/commit/b488f3bbf801404915da93d6463852ed64ee03f3))
* **contributing:** document bug-report bundles + recall-bug-finder ([716d96c](https://github.com/sound-barrier/recall/commit/716d96c9a064331cc2f3520387e5c15c7f5e90ee))
* **debt:** prune stale Next-release-focus header ([baf6db3](https://github.com/sound-barrier/recall/commit/baf6db3a36d0d3f6c9173d027b0fbf2e184a511b))
* **debt:** refresh inventory with 17 accrued items + risk dim ([0a1601c](https://github.com/sound-barrier/recall/commit/0a1601c23c6c3b55236910981ab32ae7c6b70ece))
* drain TECHNICAL_DEBT.md to template; move 7 + 13 to ROADMAP ([534d0bc](https://github.com/sound-barrier/recall/commit/534d0bcf913de3ec4be8a90a0a675512ea18ba7f))
* embed Matches view + Match detail panel screenshots in README + book ([077a9b0](https://github.com/sound-barrier/recall/commit/077a9b05c5dc7d8e80061b0e33a238e4b61fbf65))


### Tests

* **e2e:** unskip all 10 dormant describe blocks + fix 2 prod bugs ([ae0e2da](https://github.com/sound-barrier/recall/commit/ae0e2dac314c5cbea5c80fda0f20593235f2ee74))
* **frontend:** lift SFC coverage on the four hot surfaces ([8307ac7](https://github.com/sound-barrier/recall/commit/8307ac796ea197bbc5766a8794559ed6eb6185ad))
* **metrics:** pin competitive-only filter against mixed inputs ([d2a1657](https://github.com/sound-barrier/recall/commit/d2a1657a05fa4be460afb4674660a05e02e7d545))
* **server:** smoke-test mux wiring + bump Go coverage floor to 60% ([de73b8e](https://github.com/sound-barrier/recall/commit/de73b8e6a3255d76b96310d30797272ce7568c00))
* **sse:** cover SSEHub from 0 % — 6 cases, race-tested ([01615c7](https://github.com/sound-barrier/recall/commit/01615c7d42d9d40827ba2254fe08a49ca4750b73))
* **wails:** unit-test AssetServer shim, add smoke-wails target ([75eff75](https://github.com/sound-barrier/recall/commit/75eff75d6233c6a32fbcc076530ebff536c297ef))

## [0.4.0](https://github.com/sound-barrier/recall/compare/v0.3.2...v0.4.0) (2026-06-01)


### ⚠ BREAKING CHANGES

* **profiles:** LoadProfiles no longer migrates a pre-profile <base>/{settings.json,db/} layout into profiles/main/. The earlier feat(profiles)! commit's footer promised auto-migration; this commit retracts that promise. Anyone with pre-profile data needs to either: (1) move <base>/settings.json + <base>/db/ into <base>/profiles/main/ manually before first launch, or (2) start fresh and re-parse from the screenshots folder.
* **profiles:** On-disk data layout moved from <base>/{settings.json, db/recall.db} to <base>/profiles/<name>/{settings.json,db/recall.db}. Pre-profile installs auto-migrate into profiles/main/ on first launch, so the dev's existing data carries over — but any tool or script that hard-coded the old paths (db-where.sh, ad-hoc `sqlite3 $RECALL_DATA_DIR/db/recall.db`) needs to update. The GetDataLocation endpoint still surfaces the active base, so the UI's Settings → Directories pane reflects the new layout automatically.

### Features

* **api:** add /api/v1/profiles CRUD endpoints ([5af382f](https://github.com/sound-barrier/recall/commit/5af382f5365bb349bc63103895f73fba13a7e55a))
* **api:** add `unknown` to ScreenshotType enum ([2956099](https://github.com/sound-barrier/recall/commit/2956099b3f7f7218679496f8ddc14aeea27c72ec))
* **api:** add DELETE /api/v1/matches/{matchKey} for hard-delete ([d714240](https://github.com/sound-barrier/recall/commit/d7142402717dcc06921f3f5c3f025d24fceb1c1c))
* **masthead:** add ProfileSwitcher chip for multi-profile UX ([7d8863f](https://github.com/sound-barrier/recall/commit/7d8863fb639a001842acfdb2c03f439499baacbf))
* **matches:** bulk-hide selection + Archive drawer with Delete forever ([f99add7](https://github.com/sound-barrier/recall/commit/f99add7365dc971ef41844c8fe68b4ba7bc84ab5))
* **matches:** masthead parse-queue chip + first-paint skeleton rows ([6b9be2f](https://github.com/sound-barrier/recall/commit/6b9be2fd0be56f513dd18f846776e86cbdff037f))
* **metrics:** exclude hidden matches from Prometheus scrape ([ed458a1](https://github.com/sound-barrier/recall/commit/ed458a198c32da49e3ecf219e0acf87d9f099b8f))
* **profiles:** delete affordance in Settings + first-run name modal ([2b418fb](https://github.com/sound-barrier/recall/commit/2b418fbea343e70a6ffeae90637cd4fa126d4297))
* **profiles:** introduce per-installation profiles with isolated data dirs ([c7226c2](https://github.com/sound-barrier/recall/commit/c7226c27221dfe63e695b65f5814c7ec224efb81))
* **profiles:** rename profiles + bulk-move matches between them ([2e3ccb6](https://github.com/sound-barrier/recall/commit/2e3ccb6ea1b1c238f34fe65263a2be31ea65c228))
* **scripts:** make db-*.sh family profile-aware ([5ac8d49](https://github.com/sound-barrier/recall/commit/5ac8d498558846120d770e531aaea18cd0e9fc55))
* **unknown:** hover an entry reveals a peek thumbnail ([f717a03](https://github.com/sound-barrier/recall/commit/f717a03a3629ecb0c60080ed9f0ddcb23c872a11))


### Bug Fixes

* **api:** reject null in required JSON request bodies ([561a098](https://github.com/sound-barrier/recall/commit/561a0984cfdd84f667250706cabed501c605015a))
* **api:** set Content-Type before WriteHeader on POST /profiles ([250511a](https://github.com/sound-barrier/recall/commit/250511a2b450e264625cb1f7330db65eb7685c30))
* **profiles:** gate first-run modal on the onboarding tour ([8ca446f](https://github.com/sound-barrier/recall/commit/8ca446fb01adaf18904e332d17ac2f9a97b22d8e))
* **profiles:** reload after first-run rename so masthead chip updates ([cdb2595](https://github.com/sound-barrier/recall/commit/cdb2595fdb190366ffb0137941bddb14e09dfb14))
* **profiles:** sanitise target_profile via regex before path use ([216fcfc](https://github.com/sound-barrier/recall/commit/216fcfc170dcd24af399c15ffa70d612331c4eff))
* **unknown:** anchor hover thumbnail to cursor + bump size 240→360 ([2cc2750](https://github.com/sound-barrier/recall/commit/2cc2750c81ecaa7fbe5ba7fb9d3b74d4fcb801d3))
* **unknown:** preload screenshots on view mount so hover thumb shows ([68b52a9](https://github.com/sound-barrier/recall/commit/68b52a91b13021b5e194fd086dedee7e24931f0e))


### Refactors

* **matches:** contextual multi-select + Archive bulk ops ([12bde99](https://github.com/sound-barrier/recall/commit/12bde99a400768b077a90a3495d2a67acc0ae21d))
* **profiles:** drop pre-profile migration; fresh installs only ([50eea10](https://github.com/sound-barrier/recall/commit/50eea105a0361dc6633062448b328007976810bd))


### Documentation

* document multi-profile layout across README + docs + CLAUDE.md ([7fb745f](https://github.com/sound-barrier/recall/commit/7fb745f3ea4d60848fdad35a8e842afaeade2277))
* **readme:** surface ROADMAP.md via badge + TOC ([7220d34](https://github.com/sound-barrier/recall/commit/7220d34e01199e3cce2cb86821632798e54508fd))


### CI

* **schemathesis:** extract to shared script + add pre-push lefthook hook ([3d8e5c4](https://github.com/sound-barrier/recall/commit/3d8e5c4b70c0d1445a6c99f52180ab0753b32b16))


### Tests

* **matches:** cover the Move-to-profile picker in MatchesView SFC ([13e5d2f](https://github.com/sound-barrier/recall/commit/13e5d2f998b634025adcbfc91274f0f80b4bd0b3))
* **profiles:** pin &gt;2-profile + per-profile-screenshots invariants ([a45c9fa](https://github.com/sound-barrier/recall/commit/a45c9fadffd83f1f058043a3b74466971468b527))

## [0.3.2](https://github.com/sound-barrier/recall/compare/v0.3.1...v0.3.2) (2026-05-31)


### Features

* **lightbox:** screenshot prev/next within the match + h/l aliases ([4a800c6](https://github.com/sound-barrier/recall/commit/4a800c61a942bd6421dcbfd1fc904d98aaf10178))
* **theme:** map prefers-color-scheme: dark to OW-gray "dark" not "night" ([435569f](https://github.com/sound-barrier/recall/commit/435569fce3521a0724e758b060256a8dcbae1002))
* **tour:** cover ambiguous attribution in the onboarding walkthrough ([cb61204](https://github.com/sound-barrier/recall/commit/cb61204a67995a1497e54ee4208e1d88a0c452a1))
* **tour:** make the walkthrough actively demonstrate UI interactions ([0804a13](https://github.com/sound-barrier/recall/commit/0804a13b5955d135f15b103ca504e379174a82a1))
* **tour:** spotlighted product walkthrough with demo data overlay ([ecede2b](https://github.com/sound-barrier/recall/commit/ecede2b68fe8de45a2b00718205acbd3ae333396))
* **tour:** UX polish — callout placement, scroll lock, drag, step 4 retarget ([65312a1](https://github.com/sound-barrier/recall/commit/65312a100a53340a3874a3b55af0ecee898c9f06))
* **tour:** wire App.vue handlers for narrow + filter actions ([fe5b591](https://github.com/sound-barrier/recall/commit/fe5b59114b0408e5cc431a36436b4a3f7b0a16b9))


### Bug Fixes

* **tour:** honor explicit placement + wait for target slide-in to settle ([d601531](https://github.com/sound-barrier/recall/commit/d601531875c96370adc9759670c230592938e368))


### Refactors

* **nav:** move Analysis tab after Unknown so Unknown stays 04 ([20cba82](https://github.com/sound-barrier/recall/commit/20cba826b0ceacfa8703dbea2e66a501fb27d1a4))


### CI

* **bundle-size:** extract budget check to scripts/, add lefthook gate ([cbae1e9](https://github.com/sound-barrier/recall/commit/cbae1e9443041cc0d2860d73c338bed12c95a097))


### Tests

* **theme:** update e2e to expect "dark" on OS-driven dark preference ([9625f02](https://github.com/sound-barrier/recall/commit/9625f02d3bc7ac0f00b7897454314901a3363dcb))
* **tour:** extract rectsOverlap helper + lower lines threshold 68→67 ([eef3746](https://github.com/sound-barrier/recall/commit/eef374663f11bd5f61b87816fbb5dfc025a581f5))
* **tour:** update step counts + pin active-demo behaviour ([518e1ce](https://github.com/sound-barrier/recall/commit/518e1ce445fc8e562e55002995ccbb11bc3408ae))

## [0.3.1](https://github.com/sound-barrier/recall/compare/v0.3.0...v0.3.1) (2026-05-31)


### Features

* **dossier:** show in-bar play-count on Most-played-maps rows ([ae48192](https://github.com/sound-barrier/recall/commit/ae48192fc76fe497c33692c1263ca802c76ae6c6))
* **matches:** rank Top heroes by play time, surface time in the bar ([7d361e9](https://github.com/sound-barrier/recall/commit/7d361e9c20dae988e488a49110ba787020da5993))
* **matches:** rename Top→Most played, add Total time played tile ([38644a4](https://github.com/sound-barrier/recall/commit/38644a4b72c9f31d9e3f5dc5c3d05e50a8c08da3))
* **matches:** replace Record tile with Avg K/D/A per 10min ([0e05011](https://github.com/sound-barrier/recall/commit/0e05011fdf2741adb7814007a15e3887502ee11f))
* **matches:** show top hero win rate over ≥20% matches in the KPI tile ([29098d8](https://github.com/sound-barrier/recall/commit/29098d8ac2f4deb26b60aff2743596d3f25f3671))
* **settings:** add Detect/Change/Reset cluster to the Tesseract row ([0a48221](https://github.com/sound-barrier/recall/commit/0a4822136daa0e7a3dddc05643d57ea6df3948a0))
* **settings:** replace Reveal scheme call with backend action, add Reset ([0313696](https://github.com/sound-barrier/recall/commit/03136969135672a896d197f98556d1ce105a916a))
* **theme:** add OW Dark theme grounded on Overwatch brand gray ([c62975d](https://github.com/sound-barrier/recall/commit/c62975d320b84047646957532d0dc2e38b210ff3))
* **theme:** add OW Light theme grounded on Overwatch white ([43ae8bd](https://github.com/sound-barrier/recall/commit/43ae8bd570b00ca2e9958a39eb4264588a9bbd99))
* **theme:** collapse to Day / Dark / Night / High contrast set ([4c3c6c2](https://github.com/sound-barrier/recall/commit/4c3c6c26cc14ef9b64a3bf564b9c5de76d59b1b6))


### Bug Fixes

* **correlation:** auto-adopt corroborated EAD candidates in 5-30m zone ([7fb9de8](https://github.com/sound-barrier/recall/commit/7fb9de89171ce5f692b9e44b366541c803bf54dd))
* **masthead:** restore RECALL brandmark legibility in high-contrast ([59e7ebb](https://github.com/sound-barrier/recall/commit/59e7ebb441c389d7833bdec486d6dd035e11e927))
* **masthead:** user-pulled update check + dev-build gate for Analysis ([64bbff3](https://github.com/sound-barrier/recall/commit/64bbff3477e05f34201686bf9fd9a9d817250b31))
* **matches:** align masthead W/L/D with MatchesView Record tile ([329dc5a](https://github.com/sound-barrier/recall/commit/329dc5a22264c420dea8f4c57afc9dfac76dedff))
* **settings:** keep ScreenshotsDir on transient access failures ([d890815](https://github.com/sound-barrier/recall/commit/d890815df37107df96e28121142e7d3303b1d30b))
* **settings:** show Tesseract install paths for the host OS only ([0e88442](https://github.com/sound-barrier/recall/commit/0e884426f4bd73829a1a40f54cc79daf019bbebe))
* **theme:** bump --loss in Dark to clear AA on tinted bg ([8877595](https://github.com/sound-barrier/recall/commit/88775952c81810d3b0c24564a63caf9787ef069e))
* **unknown:** clickable screenshot previews + ambiguous source preview ([d37dc60](https://github.com/sound-barrier/recall/commit/d37dc60793b63c9dd92f39bc693c2622bb42935e))
* **unknown:** local expand state — stop opening Matches detail panel ([5a4fd9b](https://github.com/sound-barrier/recall/commit/5a4fd9bde6824c1c92de56bee08e9e0c388e4883))


### Refactors

* **api:** drop unused IS_WAILS export ([4a76e77](https://github.com/sound-barrier/recall/commit/4a76e77e4cb3470d69608f558830400b65617a40))
* **settings:** drop unused isReadableDir helper ([e94cf82](https://github.com/sound-barrier/recall/commit/e94cf82aa6f16620c1cdba616f657b8fc5ddbba8))


### Documentation

* **claude:** document theme set, dev-build gate, update-check pattern ([f706338](https://github.com/sound-barrier/recall/commit/f706338c156a9a5ed00001ed161d209b79e48745))


### CI

* bump total JS budget 270 → 275 KB for the Engine cluster ([152eed4](https://github.com/sound-barrier/recall/commit/152eed48f1f3f74e07cb09d476f2706a5cf54718))

## [0.3.0](https://github.com/sound-barrier/recall/compare/v0.2.5...v0.3.0) (2026-05-30)


### ⚠ BREAKING CHANGES

* Matches view UX is rebuilt. The FilterRail multi-popover is replaced by a consolidated left side panel; nested Y/M/W/D group expand is replaced by single-axis sort + group controls; per-match cards are replaced by compact leaf rows that drill into the existing detail panel. Unknown-map matches hidden by default. No backwards-compatible shim — pre-1.0, no deployed users to migrate.
* dropped App methods `SetLeaverAnnotation` and `ClearLeaverAnnotation` from the Wails IPC + HTTP surface. Callers must use `SetMatchAnnotation` with the full annotation row. The SQLite migrations layer is gone — in-place upgrades from older binaries that lacked `screenshots_dir_id` won't auto-add the column. `useWeekStart` localStorage values `"sunday"` / `"monday"` no longer hydrate; affected users fall back to the default of 0.
* filter-preset snapshots with the legacy `noteSearch` key no longer hydrate the search clause. Users with old presets will see the saved search field empty on first load.
* filter-preset snapshot field renamed from `noteSearch` to `matchQuery`. Legacy `noteSearch` localStorage values are still accepted via the parser's fallback, so existing presets keep loading.

### Features

* **api:** add PUT /api/v1/matches/{matchKey}/resolution ([a275aed](https://github.com/sound-barrier/recall/commit/a275aed6a4fed6c5ef07a0cbcb744bf1b50ddba3))
* **app:** surface ambiguous candidates on MatchRecord ([79a1c3a](https://github.com/sound-barrier/recall/commit/79a1c3af08732f41ccf722de75e34ff12363b49a))
* **cheatsheet:** context-gated bindings + capture-phase Esc ([b18efae](https://github.com/sound-barrier/recall/commit/b18efaec79199bf0ee56e7a62edf3ec6aa937416))
* **cheatsheet:** scroll with j / ↑ / k / ↓; swallow every other key ([4fde277](https://github.com/sound-barrier/recall/commit/4fde27714c22175774c53e38181c392425224401))
* **correlation:** allow multi-hero bridging via per-match hero set ([6321caf](https://github.com/sound-barrier/recall/commit/6321caf4ab8c1dea06bb52541d5489b1878b00c4))
* **correlation:** surface timestamp-window ties as ambiguous ([dcf2d87](https://github.com/sound-barrier/recall/commit/dcf2d878bdd51bbe378622c261d7713c428a7b32))
* **correlation:** time-bound EAD bridge to 30 min ([ecbdb2d](https://github.com/sound-barrier/recall/commit/ecbdb2d4fc45c766265a85d652e0452e712ed930))
* **db:** add ambiguous_screenshots tables + resolver methods ([e3d5461](https://github.com/sound-barrier/recall/commit/e3d5461c320f237add4a9935a089208ea2262b18))
* **detail-panel:** float Rank Update above Match Journal when present ([cc32e24](https://github.com/sound-barrier/recall/commit/cc32e24ec5a5ed2884627da12625f440ceb37d78))
* **detail-panel:** fullscreen screenshot lightbox ([e1e49b1](https://github.com/sound-barrier/recall/commit/e1e49b117c2918164eb53a029af25cb823e471fd))
* **detail-panel:** heroes-played always starts expanded on match select ([1930792](https://github.com/sound-barrier/recall/commit/1930792b6443890fcac7ba73dd6f983616433271))
* **detail-panel:** move Leaver + Match Stats above Match Journal ([da0da51](https://github.com/sound-barrier/recall/commit/da0da51d6e863e0860c21115beaef65932b34df6))
* **detail-panel:** rAF momentum scroll for ↑ / ↓ in the panel body ([835e283](https://github.com/sound-barrier/recall/commit/835e28321c52b58ed04ec0c4dbc0139a70b56f83))
* **detail-panel:** reorder sections + Match Stats label + rare Rank framing ([4f695b1](https://github.com/sound-barrier/recall/commit/4f695b1b3c875f917c685e64c1f4f8ffd7ad2f25))
* **detail-panel:** treat the panel as a real modal — Tab + / stay inside ([c0b4a83](https://github.com/sound-barrier/recall/commit/c0b4a83c7895dc443e28438ff2dba40ce8355a86))
* drop legacy noteSearch fallback in filter-preset parser ([cca121e](https://github.com/sound-barrier/recall/commit/cca121ed6d9d51f724fa7004046fd49b3fb0fad6))
* drop legacy paths — fresh-install only ([171541f](https://github.com/sound-barrier/recall/commit/171541feda544902e47b8c62e854d08594631675))
* global match search with vim-style scoped clauses ([5934fbf](https://github.com/sound-barrier/recall/commit/5934fbf50b4d964c1c656c4a9d2828de2347f2d3))
* **matches:** collapsible Heroes Played + Match Journal redesign ([79d47fd](https://github.com/sound-barrier/recall/commit/79d47fd13acd117e763a5d2f28de2ff137012b0e))
* **matches:** detail panel instead of inline expansion (EVAL) ([a1665a5](https://github.com/sound-barrier/recall/commit/a1665a54e48004c1a88b45124e1e494c8fef8f76))
* **matches:** filter-preset save & recall menu ([a01a979](https://github.com/sound-barrier/recall/commit/a01a979a7e38c5385ece637d20428efb1fe4b147))
* **matches:** hit highlighting + click-to-edit preview on note row ([0579de3](https://github.com/sound-barrier/recall/commit/0579de391a0ffef42e2a0d6f3485fcec2c9742ff))
* **matches:** resolve ambiguous attribution in Unknown tab ([4e3bef5](https://github.com/sound-barrier/recall/commit/4e3bef5693d910f75ed6be904beb41fc4832f987))
* **matches:** sticky group-jump timeline rail ([e356542](https://github.com/sound-barrier/recall/commit/e3565426e511b095cd79b6e3d794079a3cc3ff70))
* **matches:** timeline arrow keys + search auto-reveal in detail panel ([6699cbd](https://github.com/sound-barrier/recall/commit/6699cbd6ef90aaa0972ae8e7f337e6006f6f86a5))
* **onboarding:** first-launch briefing overlay ([4faa545](https://github.com/sound-barrier/recall/commit/4faa54579a161a305cca63f11ce00c678c7cc0cb))
* redesign Matches view as set-workspace ([e41a6c5](https://github.com/sound-barrier/recall/commit/e41a6c5b847b25df5409a8e9352469297944f87e))
* **shortcuts:** keyboard bindings + cheatsheet modal ([9c40eb1](https://github.com/sound-barrier/recall/commit/9c40eb1ed774d7f3f3a224ac44bd3b53a797c30a))
* **theme:** high-contrast variant + OS-preference autodetect ([86ad1e0](https://github.com/sound-barrier/recall/commit/86ad1e078d46bad58b8618b06826cf8f6f6a2b99))


### Bug Fixes

* **api:** require note arg in SetLeaverAnnotation for Wails bridge ([d809175](https://github.com/sound-barrier/recall/commit/d809175b66d53444c18bbd0a375683dc70046722))
* **cheatsheet:** Esc routes through [@close](https://github.com/close) so ? reopen works ([5973012](https://github.com/sound-barrier/recall/commit/597301258e95e93d004eaa4bbb92aaa0bd4a03c7))
* **detail-panel:** Esc in a text field blurs the field, not the panel ([98bf056](https://github.com/sound-barrier/recall/commit/98bf056dabc470840beaf59c0ffac4b876b42cbd))
* **detail-panel:** inert background to fully contain focus ([707d17d](https://github.com/sound-barrier/recall/commit/707d17dec13e0fde8277284129c1022316f893f3))
* **detail-panel:** nav buttons show ← / → to match key bindings ([8331e32](https://github.com/sound-barrier/recall/commit/8331e32cabc2dd123dd9547194f5a3582590e37f))
* **matches:** dossier breakdown share + no-date section position ([ea9d91a](https://github.com/sound-barrier/recall/commit/ea9d91a6c3fb99a8178769f4de1b819db6a02aec))
* **matches:** Esc clears + blurs the match-search input ([a079a41](https://github.com/sound-barrier/recall/commit/a079a416ee08a3389b893c368046a688e0aa561c))
* **matches:** preserve other annotation fields on leaver-chip click ([27f5279](https://github.com/sound-barrier/recall/commit/27f5279ef32e407a1406e82f565220d59eee2305))
* **settings:** validate screenshots folder on startup + clarify the Folders UI ([0234390](https://github.com/sound-barrier/recall/commit/0234390de83777a5bdcb33475b78adabde2a7d33))
* **update:** use semver comparison so installed releases stop prompting upgrades ([1c49eae](https://github.com/sound-barrier/recall/commit/1c49eae6631d726f88333d9e46cae9e883abeebd))


### Refactors

* **ambiguous:** drop the marker-only parent table ([6ba93fa](https://github.com/sound-barrier/recall/commit/6ba93fa4e1c2b742e5ea470bb208887341a36632))
* **matches:** extract FilterCombobox component ([49a1a82](https://github.com/sound-barrier/recall/commit/49a1a821a29fc8b16fa30c2d6a1a29cb3cf7b05a))
* **matches:** extract narrow + group + dossier composables ([598b136](https://github.com/sound-barrier/recall/commit/598b1369ce4d2186e55a1b6a22a5fc58943a6860))
* **matches:** lift narrow state so selection tracks the filter ([416df5e](https://github.com/sound-barrier/recall/commit/416df5eaa7509eea3082a3110bfe8c4f6f16d766))
* **matches:** rip dead Expand All button + rename isExpanded → isSelected ([7b4b4c7](https://github.com/sound-barrier/recall/commit/7b4b4c75e062c27c5fec6ef5589dbbcd24b47588))


### Documentation

* **claude:** allow breaking changes declared via Conventional Commits ([7cd9a48](https://github.com/sound-barrier/recall/commit/7cd9a485172db8d56a0a112a8a6ccdbb968a7baa))
* **claude:** extend Helper scripts table to cover newer entries ([5e78368](https://github.com/sound-barrier/recall/commit/5e7836885f27159d5d0611f9b4db76cfab135e8b))
* **claude:** pin gotchas surfaced by the detail-panel PR + fix stylelint ([01fba93](https://github.com/sound-barrier/recall/commit/01fba93a8f4dd475d29d08397e83eea42aa743b4))
* describe detail panel + remove dead Expand/Collapse-all entries ([dd99a07](https://github.com/sound-barrier/recall/commit/dd99a07fc90a6cffb637213b4456b61c1817a43a))
* explain Needs-your-review section in unknown-screenshots.md ([ffb7708](https://github.com/sound-barrier/recall/commit/ffb7708b48e60158a240a16aabfa2e5487bbbf61))
* **features:** mark "Match notes search" as shipped ([0273c9a](https://github.com/sound-barrier/recall/commit/0273c9a1dfbd95b2ad3a0adf550bf25e608a67e2))
* log detail-panel + lightbox + cheatsheet feature surface ([5dddcf8](https://github.com/sound-barrier/recall/commit/5dddcf83a9ffb45dea99fb9f881d48541c4bb34a))
* refresh feature backlog + UI recommendations + filtering chapter ([26d4b22](https://github.com/sound-barrier/recall/commit/26d4b228074e742e780034fcb27125eeca56897c))
* refresh for set-workspace redesign ([2a4c546](https://github.com/sound-barrier/recall/commit/2a4c546f05ce9c8c54aff9ea87dd84b52b5eab76))
* **releases:** correct wall-clock estimate against measured runs ([7258dc9](https://github.com/sound-barrier/recall/commit/7258dc91818a593eba1ed68fdfac59c2e7e524d7))


### Tests

* **app:** 400-screenshot correlation stress dataset ([0cbac62](https://github.com/sound-barrier/recall/commit/0cbac6229f6684b0cf8e4b89f41c88a3bfdc7d43))
* **app:** cohort E exercises real timestamp-window ambiguity ([f0b04d6](https://github.com/sound-barrier/recall/commit/f0b04d6d7b4c0acb2f6c8feb22a3b5a39cc9109e))
* **app:** update cohort F + G stress expectations ([9dabafc](https://github.com/sound-barrier/recall/commit/9dabafc66f64acc38706bc1dd78a56f886e72841))
* **e2e:** cover auto-close + cheatsheet + lightbox click-outside contracts ([53aee7d](https://github.com/sound-barrier/recall/commit/53aee7d6d2f4ca6a82df1eec765d5d0a74f5f7e9))
* **e2e:** pre-dismiss the onboarding tour for non-tour specs ([d12e71a](https://github.com/sound-barrier/recall/commit/d12e71acb26ba1e3538567787c21e7b9b4ff7095))
* **e2e:** skip pre-redesign specs pending set-workspace rewrites ([fdcd496](https://github.com/sound-barrier/recall/commit/fdcd496cae2b9c72be65bbdfd74b50c2a89b9126))
* **matches:** cover useIncludeUnknown + drop unused heatmap exports ([b65bb87](https://github.com/sound-barrier/recall/commit/b65bb8739a5634e0c832ff135b0807b483be6f8c))
* **matches:** migrate body assertions from MatchCard.test.ts to MatchDetailPanel.test.ts ([357f7f7](https://github.com/sound-barrier/recall/commit/357f7f7af189189b51e0acef000056ae2fd8a03f))

## [0.2.5](https://github.com/sound-barrier/recall/compare/v0.2.4...v0.2.5) (2026-05-27)


### Bug Fixes

* **release-please:** repair stale-label cleanup in push-release-tag.sh ([8e4a484](https://github.com/sound-barrier/recall/commit/8e4a4849563bc42d5275738ac14cd53202e4ae8e))

## [0.2.4](https://github.com/sound-barrier/recall/compare/v0.2.3...v0.2.4) (2026-05-27)


### Documentation

* **releases:** align RELEASES.md with current pipeline state ([0559c3f](https://github.com/sound-barrier/recall/commit/0559c3f9dba7411ae22dd580604c971aaa860fbd))


### CI

* **release-please:** auto-push the release tag after PR merge ([e30cd65](https://github.com/sound-barrier/recall/commit/e30cd65bbb82cc52adfde731dcf4a5c4c522fe3c))
* **release-please:** drop RELEASE_PLEASE_TOKEN PAT, use GITHUB_TOKEN ([f6d02d9](https://github.com/sound-barrier/recall/commit/f6d02d9895a32420bf60ecdcb038d0064bb4d6c5))

## [0.2.3](https://github.com/sound-barrier/recall/compare/v0.2.2...v0.2.3) (2026-05-27)


### CI

* bump Node 20 actions to Node 24 ahead of June 2 forced cutover ([2038d68](https://github.com/sound-barrier/recall/commit/2038d689bb4b898e9bc5184feaa3cb65f43efa9d))
* **release:** matrix-parallel builds + shared cache + post-release container push ([bff6318](https://github.com/sound-barrier/recall/commit/bff63188ccb48f2ac2b39c3d66c88dbbf8bf391a))

## [0.2.2](https://github.com/sound-barrier/recall/compare/v0.2.1...v0.2.2) (2026-05-27)


### Bug Fixes

* **release:** retry hdiutil create on "Resource busy" flake ([7cc4262](https://github.com/sound-barrier/recall/commit/7cc42625a758f50ef3ef80c2d7e01c6c68e90199))
* **release:** skip-github-release so release-please pushes the tag ([29d3cc5](https://github.com/sound-barrier/recall/commit/29d3cc550def3165d5147aed76145c05f27f97d5))

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
