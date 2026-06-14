# Changelog

## [0.14.1](https://github.com/sound-barrier/recall/compare/v0.14.0...v0.14.1) (2026-06-14)


### Features

* **app:** SeedProfile + on-demand SeedTestProfile handler ([f9cf3c2](https://github.com/sound-barrier/recall/commit/f9cf3c2c48b57d40c7f5d86c255a947fd2dcc121))
* **onboarding:** seed + switch into the sample "test" profile, ending the tour there ([7449036](https://github.com/sound-barrier/recall/commit/74490369ed06fde6d7611f5f31423359bb585c32))


### Bug Fixes

* **app:** surface previously-swallowed settings/store/reload errors ([8bfb794](https://github.com/sound-barrier/recall/commit/8bfb7940c5f2e3ba4abd8f27b77ff097c49d4bce))
* **scripts:** cd the stack helpers to the repo root, not scripts/ ([4e96f32](https://github.com/sound-barrier/recall/commit/4e96f32811072b5f5c4a0cebad3d4d8de19bc25a))
* **scripts:** let shellcheck follow externally-sourced libs ([f4cd350](https://github.com/sound-barrier/recall/commit/f4cd350e658abec9a9ae7fa11060d69bf63ed8e1))
* **scripts:** point tour-test.sh at the real repo root ([c9b05e6](https://github.com/sound-barrier/recall/commit/c9b05e607f409d1e3c3bef9c04ce69e3b3fc9dbe))


### Refactors

* **app:** decompose CheckForUpdate into fetch/compare helpers ([f59ba92](https://github.com/sound-barrier/recall/commit/f59ba92ba2a71ffbb4aebf020a4d743749d9ed8d))
* **app:** decompose ExportBundle into phase helpers ([4600ac0](https://github.com/sound-barrier/recall/commit/4600ac0fe1e4c7fdf2d5282f839dec81a8e40d44))
* **app:** decompose GenerateMatchFixture into phase helpers ([c32f5d1](https://github.com/sound-barrier/recall/commit/c32f5d1763787beb869a194e13bd72be3988f30b))
* **app:** decompose importDataCSV; share parent-upsert with JSON path ([7d116b0](https://github.com/sound-barrier/recall/commit/7d116b0691b35b903c48bd509776a0baa57765ba))
* **app:** decompose importJSONv1 into validate/clear/import helpers ([2ad026e](https://github.com/sound-barrier/recall/commit/2ad026e5df698090100a8f7505fbd0b604a35d62))
* **app:** decompose matchByEAD into scan/sort/resolve helpers ([920cdc8](https://github.com/sound-barrier/recall/commit/920cdc805247760b27c4a99e064452487c2f064a))
* **app:** decompose MoveMatches into validate/load/phase helpers ([e08d40c](https://github.com/sound-barrier/recall/commit/e08d40ca4f67f051eef1256be7b521681cc36d96))
* **app:** decompose ValidateBundle into per-check helpers ([a62de31](https://github.com/sound-barrier/recall/commit/a62de314b60d931daa27055e5436852849fbea74))
* **app:** drop unreachable post-Startup wiring assertion ([49ec3c2](https://github.com/sound-barrier/recall/commit/49ec3c23c192940ad0adadf156cf0d85b82fb1e9))
* **app:** extract collectViewsForKey + sidecars from aggregateMatchKey ([8aa0ce9](https://github.com/sound-barrier/recall/commit/8aa0ce937418fde82022f1a27502f3d1ef6995cd))
* **app:** extract parseRunState from runClaimedParse; drop dead value ([4e500a3](https://github.com/sound-barrier/recall/commit/4e500a32fa13ed156b587ad544e433340e89b10c))
* **app:** extract resolveScreenshotPath from ScreenshotHandler ([23fa11f](https://github.com/sound-barrier/recall/commit/23fa11f956c6c281e7b2ed9f4c92a385fa8611fd))
* **app:** lift ensureCoverage's shared state into coveragePatcher ([46c1df3](https://github.com/sound-barrier/recall/commit/46c1df3dc3a08db0752074a6ab778d737aca150f))
* **app:** roll the synthetic-match date window off time.Now ([8faca58](https://github.com/sound-barrier/recall/commit/8faca5827e4d9ad2faedac22713a12b4e577c632))
* **app:** split aggregate.go by concern ([68eb03a](https://github.com/sound-barrier/recall/commit/68eb03af0cd7e23abd1e2e8c1651779d201c0b05))
* **app:** split correlation.go by concern ([04f04da](https://github.com/sound-barrier/recall/commit/04f04da89410235aaf9cf6a0c690f9c99f8c16db))
* **app:** split export_csv.go by concern ([88f3cee](https://github.com/sound-barrier/recall/commit/88f3cee7184d6d9e5ce113047c6166a61b31e413))
* **app:** split fixtures.go by concern ([cac8f26](https://github.com/sound-barrier/recall/commit/cac8f265c8b61a74677f9432f0f8ab1db4eca747))
* **app:** split pickHero into per-style methods ([3cd18c2](https://github.com/sound-barrier/recall/commit/3cd18c227189c4a034e5bb3ff64284732cdd5741))
* **app:** split Startup into phase helpers ([9ccae39](https://github.com/sound-barrier/recall/commit/9ccae399dda3dc99d68ad15f248a1c844262871e))
* **app:** split update.go by concern ([64e42cb](https://github.com/sound-barrier/recall/commit/64e42cb508335e30b5afad7f5f2c3a2c4daaa65c))
* **cmd:** extract handlers from the profile/backup/settings routes ([f9b2d87](https://github.com/sound-barrier/recall/commit/f9b2d87d560c5c7acd6f96720012206907c5681e))
* **cmd:** extract match-route handlers from registerMatchRoutes ([ddb53cd](https://github.com/sound-barrier/recall/commit/ddb53cd19e5b7661b4953d29525bf5cb93985a3d))
* **dashboard:** decompose MatchHeroModeBand into drill-nav + levels ([ec92310](https://github.com/sound-barrier/recall/commit/ec92310262a6b043064ec4a7172cb378d8821863))
* **dashboard:** drop unused WINDOW_MONTHS export ([0354dbf](https://github.com/sound-barrier/recall/commit/0354dbfcc9ffe779d0e592940053478eeac340ee))
* **dashboard:** extract shared useWindowMonths composable ([1a9ecd4](https://github.com/sound-barrier/recall/commit/1a9ecd414f88ba85c64f9a841157e2337554a7d9))
* **dbtest:** split fake.go by Store-method domain ([da2f51e](https://github.com/sound-barrier/recall/commit/da2f51eb7386df5760e1f4cc8b89506c24e0d577))
* **detail:** extract useSmoothScroll composable ([9f8c1f7](https://github.com/sound-barrier/recall/commit/9f8c1f71af764776af1bcf7da0457fc82a4b9b6f))
* **dossier:** extract type contract into its own module ([9427a3d](https://github.com/sound-barrier/recall/commit/9427a3d7a37113f9410bd83658cbfd8eb86cfd7e))
* **dossier:** split query-helper tier into sibling composable ([ca038e1](https://github.com/sound-barrier/recall/commit/ca038e16c1c8fb195b6d1526f94dc29ef869de52))
* **ignored:** extract useHoverThumbnail composable ([845a201](https://github.com/sound-barrier/recall/commit/845a2014667b5073a9b0062cfbd41cf3642d5e50))
* **matchcard:** extract annotation editor into a composable ([4a73849](https://github.com/sound-barrier/recall/commit/4a73849b75838894069699113d160fe07c51b8f5))
* **matchcard:** extract MatchHeroesPlayed sub-component ([fa187f3](https://github.com/sound-barrier/recall/commit/fa187f37d32dbe5779ca02eb24cba576865205f5))
* **matchcard:** extract MatchJournal sub-component ([bcb9ffc](https://github.com/sound-barrier/recall/commit/bcb9ffc6763b473086ab7e9fa3f0699334ad0064))
* **matchcard:** extract MatchLeaverChooser sub-component ([7aea795](https://github.com/sound-barrier/recall/commit/7aea7956e0b183f3d90bc08919bd679f3f33ddcf))
* **matchcard:** extract MatchRankBlock sub-component ([52a1849](https://github.com/sound-barrier/recall/commit/52a18498bfcc5216da377eac421b4b13532699ba))
* **matchcard:** extract MatchSources sub-component ([d88f623](https://github.com/sound-barrier/recall/commit/d88f623b79fa74c8636a5f25ce8c80031befa5eb))
* **matchcard:** extract MatchStatusChoosers sub-component ([c2d0a0c](https://github.com/sound-barrier/recall/commit/c2d0a0c54ddec29a678e3f7fc69f1307a43962ed))
* **matches:** decompose MatchesView shell into composables + toolbar ([6352cf9](https://github.com/sound-barrier/recall/commit/6352cf98e266ccdd63a826ce503df4f4f335dacf))
* **matches:** extract MatchesTable from MatchesMembersList ([9296c91](https://github.com/sound-barrier/recall/commit/9296c91e3a1dece5fb8bf16ea159c23742dc859d))
* **narrow:** extract NarrowPresets from NarrowPopover ([c27a8cc](https://github.com/sound-barrier/recall/commit/c27a8cc58531172fb89d974d437aa680f097430b))
* **parser:** decompose findStatColumns into scan/cluster/merge ([f085281](https://github.com/sound-barrier/recall/commit/f085281ab4de1f844664418c3824aeeefd27db34))
* **profiles:** extract useProfileSwitcher composable ([ebf3933](https://github.com/sound-barrier/recall/commit/ebf393366d98fbfd222ca3420cd3267367da59fb))
* **settings:** extract SupportedSourcesRow sub-component ([d933133](https://github.com/sound-barrier/recall/commit/d933133b53d77fa014b8af88fd0ffa054dd25a11))
* **tour:** extract computeCalloutPosition placement solver ([8957a02](https://github.com/sound-barrier/recall/commit/8957a02fd4452fc3879039abeadd0b53159e7b30))
* **unknown:** reuse useHoverThumbnail in UnknownMapsView ([aa0bbbd](https://github.com/sound-barrier/recall/commit/aa0bbbddcb140a1aa3bc11204828a4ba3a938dc6))
* **update:** split UpdateCheckModal game-data logic + diff manifest ([8ebd94d](https://github.com/sound-barrier/recall/commit/8ebd94d1acce8d265fe93dd78f507062d180fbce))


### Documentation

* **claude:** add best-effort file-length guideline (~500 lines) ([d3d8afd](https://github.com/sound-barrier/recall/commit/d3d8afd86baca2ab31922b7a13daed310ae53f83))
* **faq:** explain profiles and how to delete the sample "test" one ([45ed3bb](https://github.com/sound-barrier/recall/commit/45ed3bb38ca2b48e135a4a8af8149ee2acd6f8f5))
* **review:** clear Q3 large TS composables ([5e728ff](https://github.com/sound-barrier/recall/commit/5e728ff56d96b547f54884416f025a98f1aae8fa))
* **review:** clear Q4 and refresh complexity baseline paths ([3ccebae](https://github.com/sound-barrier/recall/commit/3ccebae9da1e924632b879205dc4f100a69ac74c))
* **review:** clear Q6 coverage floor ([2e2a7e7](https://github.com/sound-barrier/recall/commit/2e2a7e7115e391894fed4fdf285edcb8a9e84347))
* **review:** record Q2 outcome (decomposed; two dense shells best-effort) ([0e999be](https://github.com/sound-barrier/recall/commit/0e999bed2d1eb36c789d5359ee264dc5b27c0825))
* **review:** record Q5 done — all Go tests black-box via bridges ([8ead8cd](https://github.com/sound-barrier/recall/commit/8ead8cd6417b55033be6521c413c5a2c80ffd55c))
* **review:** record Q5 outcome (black-box where exported surface allows) ([ccdccb4](https://github.com/sound-barrier/recall/commit/ccdccb4e8b4055ded59274ddd83462f17c488dee))
* **review:** record the CLAUDE.md code-quality audit ([7a508de](https://github.com/sound-barrier/recall/commit/7a508debef5c1b1405b87268ccaf7f853e83eac9))


### Build & Packaging

* **bundle:** bump total JS budget to 498000 for the Q2 composable split ([ea03286](https://github.com/sound-barrier/recall/commit/ea0328601e4c7ce338d199ba129a3b998ca9d500))
* **bundle:** bump total JS budget to 500000 for the card decomposition ([8f1548a](https://github.com/sound-barrier/recall/commit/8f1548a62b92e0cd907e086d63a2d15359da1ddc))
* **bundle:** bump total JS budget to 502000 for the medium SFC trims ([c745e8d](https://github.com/sound-barrier/recall/commit/c745e8db483f4e67c3705f389b3688cd6731786f))
* **bundle:** bump total JS budget to 506000 for the dense-view split ([d71949f](https://github.com/sound-barrier/recall/commit/d71949f051070d9498c49caaa850d619954b3006))
* **lint:** add ruff for Python; clean render-pr-report.py ([e656e8b](https://github.com/sound-barrier/recall/commit/e656e8bf19b19d87b450db72efcf867e081cdba0))
* **lint:** bring initialize.sh + devcontainer under shfmt/shellcheck ([bd60e26](https://github.com/sound-barrier/recall/commit/bd60e2672bf8c9dec32efe98beab6183df1a30e4))
* **lint:** htmlhint the Swagger UI page too, not just the SPA index ([3d26abb](https://github.com/sound-barrier/recall/commit/3d26abbd7c2c5864f129cab194b3b2639a21cc95))
* **lint:** run ESLint over the whole frontend, not just src/ ([3b9eb17](https://github.com/sound-barrier/recall/commit/3b9eb173943375b44ea0967bf4569f538e860437))
* **lint:** stop enforcing YAML line length ([894bc6d](https://github.com/sound-barrier/recall/commit/894bc6d9374b501a22b990402713017c6c64e5e1))


### Tests

* **app:** externalize all 47 test files to package app_test ([85ba341](https://github.com/sound-barrier/recall/commit/85ba34197ead965f1c39ed5736bfaeb7baf82cbe))
* **app:** externalize check-state + match-key tests to package app_test ([1b9b2e9](https://github.com/sound-barrier/recall/commit/1b9b2e9bb7de871736789ec3396b564d98dc0bff))
* bump test-skips allow-list line numbers after externalizing ([6286c7e](https://github.com/sound-barrier/recall/commit/6286c7e0125294048a0974c3845ba88cc6391663))
* **cmd:** externalize HTTP route tests to package cmd_test ([9b3d517](https://github.com/sound-barrier/recall/commit/9b3d51760c25dbb351b9d20b96c61bdfe82970dc))
* **cmd:** externalize middleware + hardening tests to package cmd_test ([8a70a0f](https://github.com/sound-barrier/recall/commit/8a70a0f63068491999a52d7d3cf9845ec7c7baaf))
* **db:** externalize migrate_test to package db_test ([ad79587](https://github.com/sound-barrier/recall/commit/ad79587552a9b5121bf025f0e39a5791ef744e5e))
* **db:** externalize store round-trip tests to package db_test ([7eb595c](https://github.com/sound-barrier/recall/commit/7eb595c541735c766d677aa01d47fc8ea7f1780e))
* **e2e:** hold the SSE mock instance on a static field ([9bc8b47](https://github.com/sound-barrier/recall/commit/9bc8b47604df97f6f1d38db7959c06fb365b5917))
* externalize metrics + applog tests to package &lt;pkg&gt;_test ([f6e8b8d](https://github.com/sound-barrier/recall/commit/f6e8b8d859f5566762a95a867ca445ea56d9e798))
* **parser:** externalize all 13 test files to package parser_test ([0ddb598](https://github.com/sound-barrier/recall/commit/0ddb598fcca3df54751bcc43a89fd726aadd1fbc))
* **tesseract:** cover detectTesseractBinary probe paths ([e33be94](https://github.com/sound-barrier/recall/commit/e33be94e976f5435405524d3da3abff021caef0b))

## [0.14.0](https://github.com/sound-barrier/recall/compare/v0.13.0...v0.14.0) (2026-06-12)


### ⚠ BREAKING CHANGES

* **parse:** POST /api/v1/parses returns 202 the instant the run is accepted (not when it finishes) and returns 409 when a parse is already in flight. Clients must treat parse-complete (SSE) + GET /api/v1/parses/active as the completion/resync signal, not the POST resolving. Pre-1.0, no migration.

### Features

* **dossier:** add mapCounts + recentMatches aggregates ([38f5620](https://github.com/sound-barrier/recall/commit/38f5620f77a91e7be105982ed9160507ced3a991))
* **dossier:** add win-rate-by-teammate widget ([7ec5bf4](https://github.com/sound-barrier/recall/commit/7ec5bf4ec1bfdb0c995edfa39488ca9f06b0dedd))
* **dossier:** scope heroGameModeCounts to a trailing window ([3295f57](https://github.com/sound-barrier/recall/commit/3295f570fd64f03185878c1916d33256fd0681ae))
* **matches:** add teammate (member) narrow filter ([18e217d](https://github.com/sound-barrier/recall/commit/18e217d88251a40d1c9c4a45f100411ec8cd06b7))
* **matches:** data density is a flat sortable spreadsheet in a scroll pane ([33d245b](https://github.com/sound-barrier/recall/commit/33d245b062b8ba2018ce6addf8d1b517670d7e85))
* **matches:** drill-down stack + Go back for the Hero × Game-Mode band ([b8ef752](https://github.com/sound-barrier/recall/commit/b8ef7529a9fb204f396a34fc7127d1359122bccb))
* **matches:** Hero × Game-Mode is a movable, configurable dossier row ([f52988c](https://github.com/sound-barrier/recall/commit/f52988cadad6067df62bc0af8c09495abd2d27bb))
* **parse:** event-driven parseBusy + SSE-drop recovery UI ([b7f02d9](https://github.com/sound-barrier/recall/commit/b7f02d99e89ad98fd12fe00914d391a6bc5f9676))
* **parse:** run parses as a background job + GET /parses/active ([6550cc5](https://github.com/sound-barrier/recall/commit/6550cc58ff4f856fbfaed8878b4b1e80729cc22f))
* **windows:** single Reset-Database.bat to wipe the DB (backs up first) ([ca8fd2c](https://github.com/sound-barrier/recall/commit/ca8fd2c4d8f44978de2ca08fddd9f6aa891c4af4))


### Bug Fixes

* **matches:** data-table sort by match time + most-played hero; year-aware dates ([b4de44e](https://github.com/sound-barrier/recall/commit/b4de44e6b8d1887a4f5326169c08dca0dfdcfc01))
* **matches:** keep the Hero × Game-Mode band a constant height when drilling ([10b1784](https://github.com/sound-barrier/recall/commit/10b17848565bdd8566614c69dcf53144b7657b8c))
* **matches:** stop the page jumping when narrowing from a dossier affordance ([82d38bd](https://github.com/sound-barrier/recall/commit/82d38bdee0f0d713ac64d324f623f8a0ca8f782d))
* **tour:** settle on the target's final rect, not a timed guess ([75da588](https://github.com/sound-barrier/recall/commit/75da5880bfe840d50236425afb960884bf894037))


### Refactors

* **api:** single shared EventSource + connection-status handler ([bcd337f](https://github.com/sound-barrier/recall/commit/bcd337f5bde171313fc92f919579314f4a20b627))
* **matches:** extract MatchesDossierHead.vue ([16c8fa5](https://github.com/sound-barrier/recall/commit/16c8fa50daa037367d3d10dde5f4e6467d51b59b))
* **matches:** extract MatchesDossierSections.vue ([0b8de2b](https://github.com/sound-barrier/recall/commit/0b8de2be8478c5a292ba1fccd71d8b5fc508ac5f))
* **matches:** extract useMatchesRowContext composable ([5d3f7a8](https://github.com/sound-barrier/recall/commit/5d3f7a89cfaadda11be9eb08eaf85c0b2304cc7e))


### Documentation

* document resetting the database (no migrations) + FAQ ([1f0d03d](https://github.com/sound-barrier/recall/commit/1f0d03dc75e83c57b7ea193cce4e17680237a929))
* **review:** drop B1 — parse pipeline is now drop-resilient ([2b64b78](https://github.com/sound-barrier/recall/commit/2b64b78f0a04983c0388dd5208fc0f66281f81bf))
* **review:** drop D1 — teammate feature supersedes the member index ([9f215c6](https://github.com/sound-barrier/recall/commit/9f215c66b87ba64254b381f69f7ebd98a5bf0941))
* **review:** drop the paid D2 MatchesView-split item ([c479935](https://github.com/sound-barrier/recall/commit/c479935ee593b959ac1e3802fa8d26d39e81e2f8))
* **review:** park F3 + D4 in out-of-scope ([37c2afd](https://github.com/sound-barrier/recall/commit/37c2afd433cb4601f14357b23db71e258782050b))


### Build & Packaging

* **bundle:** raise total-JS budget to 488000 for teammate analysis ([47dbc58](https://github.com/sound-barrier/recall/commit/47dbc583de1376895393463d1b0f6b0351e3b549))
* **deadcode:** allow-list ReParseAll as Wails-only ([f6f902c](https://github.com/sound-barrier/recall/commit/f6f902cdb2bc5b1620761de7f0d8fdea56e96519))
* **release:** publish + bundle the Windows reset-DB script ([59a3bca](https://github.com/sound-barrier/recall/commit/59a3bca853e0fe1cb4842af221a813f09045882f))
* **windows:** keep scripts/windows in the Docker context for the installer ([3b10f9e](https://github.com/sound-barrier/recall/commit/3b10f9e1b7a29f735fd38af4f42ead645a5b7f79))

## [0.13.0](https://github.com/sound-barrier/recall/compare/v0.12.0...v0.13.0) (2026-06-12)


### ⚠ BREAKING CHANGES

* **db:** teams_screenshots drops map/map_raw/playlist/hero/hero_raw; teams.csv backups from older versions no longer import.
* DB tables scoreboard_screenshots/scoreboard_hero_stats renamed to teams_screenshots/teams_hero_stats; the ScreenshotType API value "scoreboard"→"teams"; the export-bundle field scoreboards→teams and ScoreboardExportRow→TeamsExportRow. Pre-1.0, no migration — wipe the dev DB.
* MatchData.type → game_mode; the OWData reference-data field maps_by_type → maps_by_game_mode; the "type" Prometheus label → "game_mode". Pre-1.0, no migration.
* summary_screenshots.mode + scoreboard_screenshots.mode columns renamed to playlist; the MatchData.mode JSON field, the "mode" Prometheus label, and the CSV "mode" column are now playlist. Pre-1.0, no migration — wipe the dev DB and relaunch.
* scoreboard_screenshots gains a queue_type column. Pre-1.0 there is no migration — wipe the dev DB (per-OS paths in CONTRIBUTING.md) and relaunch.

### Features

* auto-detect queue type from scoreboard player count ([54c14c6](https://github.com/sound-barrier/recall/commit/54c14c67323da570c168d7d15563f6a35a9d7912))
* **matches:** data-density table with sortable columns ([83377b1](https://github.com/sound-barrier/recall/commit/83377b132364e01b6db35fea0c3f4aba4d7d3312))
* **matches:** scoped-clause search in the narrow panel ([53ff591](https://github.com/sound-barrier/recall/commit/53ff5915da8cc0696fdc261bdeede810d48053ad))
* **scripts:** Windows desktop-user maintenance scripts ([7308f54](https://github.com/sound-barrier/recall/commit/7308f5418b7c7a348e022eaa750af26f1c196da3))
* **theme:** add --identity-accent for OW-identity typography ([96d3d66](https://github.com/sound-barrier/recall/commit/96d3d66e319dba8a07094e03155fbfeedb908c25))


### Bug Fixes

* rank-only playlist, mode→playlist rename, OCR digit fixes ([b00e83e](https://github.com/sound-barrier/recall/commit/b00e83e5967bfabff179d3c0cff272067aa4bdd5))


### Refactors

* **db:** drop unused teams identity columns ([1e6f362](https://github.com/sound-barrier/recall/commit/1e6f362c86a141a1c8eaaf1a35fe4e91acf9f4e8))
* finish game_mode rename through internal frontend names ([55a8d12](https://github.com/sound-barrier/recall/commit/55a8d129491de4cd1825259ddac279f82b4c9523))
* **log:** migrate remaining log.Printf sites to slog ([738183d](https://github.com/sound-barrier/recall/commit/738183d1d0e6b0a4e8c97e773d99b403890ec358))
* **matches:** extract MatchesArchiveDrawer.vue from MatchesView ([d43a50f](https://github.com/sound-barrier/recall/commit/d43a50f9f6a007064d6b794b9de965423162c60b))
* **matches:** extract MatchesDossier.vue from MatchesView ([53eb4b7](https://github.com/sound-barrier/recall/commit/53eb4b73ff98a159dd89fc65e2b15ee28efdc666))
* **matches:** extract MatchesMembersList.vue from MatchesView ([c01a982](https://github.com/sound-barrier/recall/commit/c01a982265c5334e2c23acdf525d92c935cf7e43))
* **matches:** extract MatchLeafRow.vue from MatchesView ([4cd0a8d](https://github.com/sound-barrier/recall/commit/4cd0a8dae029ecd5982a6708ff405e8734b9cae1))
* **matches:** hoist leaf/archive row formatters to match-helpers ([40526b2](https://github.com/sound-barrier/recall/commit/40526b2abe4873dd571d322fc10ba724b45129e4))
* **parser:** teams screenshot contributes combat stats only ([5227aef](https://github.com/sound-barrier/recall/commit/5227aefc936ee79a1ec832613a535641f21b0f00))
* remove the dev-only Analysis tab ([3bab2a3](https://github.com/sound-barrier/recall/commit/3bab2a37cf4ff0f95a288cc480bab85fea3f83b8))
* rename scoreboard→teams (screenshot type) ([937a364](https://github.com/sound-barrier/recall/commit/937a364ec4932f74bae3fc96602fb682aef172df))
* rename type→game_mode (control/escort dimension) ([036d33f](https://github.com/sound-barrier/recall/commit/036d33fbe83a7d7dee5005ae6e10a8fe219a49e1))
* **scripts:** organise into lib/db/ci/stack subdirs ([2e2acbd](https://github.com/sound-barrier/recall/commit/2e2acbddb1cbae04fa10afe789bb819b144ba023))


### Documentation

* expand working-style + TDD conventions in CLAUDE.md ([4b09bf9](https://github.com/sound-barrier/recall/commit/4b09bf9cea2c5024a3aaf1b3446e8b50f969d20d))
* **faq:** advise post-match screenshots + add FAQ chapter ([56da972](https://github.com/sound-barrier/recall/commit/56da972756352173a85ad5beb4015ca6ecea44ef))
* fix coverage make-target reference (make coverage → make cover) ([50d2efc](https://github.com/sound-barrier/recall/commit/50d2efcd22f81e3a6118d2895f691e7e3e61fbba))
* fold release-plan/followups/roadmap into REVIEW.md ([56f063b](https://github.com/sound-barrier/recall/commit/56f063b23cd0c13925d67c9fbc0494a1f6fc70fe))


### CI

* **lefthook:** fail-fast in multi-command pre-push run blocks ([72e0d28](https://github.com/sound-barrier/recall/commit/72e0d2813ec1ab43e8dac3b0e1de87d79cf9b3f7))


### Tests

* **e2e:** de-flake the tour-callout geometry assertions ([ab81cef](https://github.com/sound-barrier/recall/commit/ab81cefbc7ffd86569c9add6c6aa93b67df85361))
* **e2e:** fix missed mode→playlist mocks ([b777b3e](https://github.com/sound-barrier/recall/commit/b777b3ec1c61207d9b681348daa55e6ae6ab3a94))
* **e2e:** rename mode→playlist in match mocks ([8e5348f](https://github.com/sound-barrier/recall/commit/8e5348f92ec78881813f5388bd7f7ffa02985e3e))
* **e2e:** rename reference-data mocks maps_by_type→maps_by_game_mode ([d34f456](https://github.com/sound-barrier/recall/commit/d34f456a9adaf6f05bf7fec4a303f0ce1b8f6af1))
* **matches:** target #np-search, not the changed placeholder ([917ff90](https://github.com/sound-barrier/recall/commit/917ff90a8c55a2ac147721d53302db7ec3af0bbd))
* **parser:** drop never-derived playlist from non-rank goldens ([71dee3c](https://github.com/sound-barrier/recall/commit/71dee3c4d726fc5a9672deab98d06fc369d460f0))
* **parser:** pin open-queue detection with a 6v6 golden ([66c286c](https://github.com/sound-barrier/recall/commit/66c286cf7a2402be8fca0e1b1e13018e251b37e6))

## [0.12.0](https://github.com/sound-barrier/recall/compare/v0.11.0...v0.12.0) (2026-06-11)


### ⚠ BREAKING CHANGES

* handler-level 400 vs 500 routing for the two settings PUT endpoints is now consistently 400 + the canonical error message. The export-import 400-vs-409 split is tightened — inner struct decode failures land on 409 (was 400 in the PR #1 follow-up; the PR #1 split for the outer schema-peek decode remains 400).
* `screenshots_dir_id` columns are now `NOT NULL`. Any pre-existing DB with a NULL dir_id won't open; dev DBs must be wiped (CONTRIBUTING.md carries the per-OS wipe path). The OpenAPI `SummaryExportRow.screenshots_dir_id` description loses the "0 = NULL" clause (and gains `minimum: 1`); `POST /api/v1/imports` now returns 400 for malformed payloads (was 409 unconditionally); the import error message prefix changed from "import csv: ..." / "import: ..." to "import: malformed payload: ..." on the 400 branch.

### Features

* **matches:** gear filter for the Geography (Map × Role) band ([aef9c52](https://github.com/sound-barrier/recall/commit/aef9c5250a7adb7823244599b05173c81d0a01f1))
* **matches:** Geography Map × Role performance band ([72b6499](https://github.com/sound-barrier/recall/commit/72b6499f44f1454c7d1d099889e16149c0b3de48))
* **matches:** inline dossier management, no edit mode ([4d741e1](https://github.com/sound-barrier/recall/commit/4d741e13a271127d988f4702ea67483fa962248d))


### Bug Fixes

* **a11y:** pre-1.0 sweep (1.0 plan §C) ([2720937](https://github.com/sound-barrier/recall/commit/2720937fef2d3dce7c0287abed4b78ad5196d02d))
* apply 3 of 7 code-quality AI findings (decline 4) ([b03ae95](https://github.com/sound-barrier/recall/commit/b03ae95fcf29dff779aef3a69ca0ce4988db06b3))
* **cheatsheet:** install Esc handler at mount, not on prop change ([2062834](https://github.com/sound-barrier/recall/commit/20628342f730d521637266ad582d45d174a6dd8b))
* **import:** bound decompressed ZIP reads against zip bombs ([ba39b66](https://github.com/sound-barrier/recall/commit/ba39b669dc2797af4d2faf26f322ae869e9f2d84))
* **matches:** even vertical spacing between dossier and the bands ([a75656b](https://github.com/sound-barrier/recall/commit/a75656b03344b1cd5457bb664cf2a9643c0bfeff))
* **matches:** freeze background scroll under every overlay; no jump ([52d44c6](https://github.com/sound-barrier/recall/commit/52d44c6dd90a0e40a85faeb2b5e7134b96521be2))
* **matches:** smaller hover-only dossier controls, on-screen Add menu ([61627fb](https://github.com/sound-barrier/recall/commit/61627fbaf6ed5b791e9cb9f1bc0899ae79dee550))
* **matches:** stabilize sticky Campaign Log below tall content ([21e9426](https://github.com/sound-barrier/recall/commit/21e94266df2461dd9d7913ebfdff3c9b707b73b2))
* **metrics:** warn on non-loopback metrics bind + document exposure ([4a8fec6](https://github.com/sound-barrier/recall/commit/4a8fec61fdb29c6bdad3d563e9d3e4463a53b3ab))
* **perf:** boot pre-fetch + lazy-view loading overlay (P1-C) ([bc2eea9](https://github.com/sound-barrier/recall/commit/bc2eea99f95683a9dc1c066811a22a6b7afadf60))
* **server:** cap request bodies + nosniff header ([b47dd13](https://github.com/sound-barrier/recall/commit/b47dd13cf9de4c70705a2945bc39b58c78b3e265))
* **server:** warn on exposed pprof + pin metrics label escaping ([7dc015e](https://github.com/sound-barrier/recall/commit/7dc015e655034a20d44f6ef936870f64e2c31326))
* **stylelint:** empty-line-before-comment in MatchCardDanger ([f9e0832](https://github.com/sound-barrier/recall/commit/f9e08328ff6ac8ddbc4a0dc92b6830e2742f3248))
* **stylelint:** hoist countdown-ring comment above the rule block ([1f683fd](https://github.com/sound-barrier/recall/commit/1f683fd66008d34ffbc9dc84ab9b7042184016da))
* **ts:** annotate lazyView loader signature to break circular inference ([412e9d0](https://github.com/sound-barrier/recall/commit/412e9d05d9138e6fa2e76501f16cf730838c5e87))
* **update:** restrict redirect targets on update fetches ([85778a5](https://github.com/sound-barrier/recall/commit/85778a558dd189840b16080f6e6cddb32d4b62e9))
* **ux:** first-run + error states (1.0 plan §C — 5 of 6 items) ([0f726e4](https://github.com/sound-barrier/recall/commit/0f726e41471d3e9f5230c1299d39b9cbb7f0230a))
* **ux:** Matches/Unknown polish (1.0 plan §C — Matches/Unknown) ([03fb1b0](https://github.com/sound-barrier/recall/commit/03fb1b043a6e45127a1578a8a9f1551ec4f5628a))
* **ux:** microcopy sweep (1.0 plan §C — P1-D) ([53efa06](https://github.com/sound-barrier/recall/commit/53efa064160670173f5a19c600c26236cb736b9c))
* **ux:** Settings + Parse polish (1.0 plan §C — P1-A) ([3138b9b](https://github.com/sound-barrier/recall/commit/3138b9b0d3c5ef04ff947cd177be13766cf2d1ee))
* **ux:** Unknown view polish (1.0 plan §C — P1-B) ([d74be18](https://github.com/sound-barrier/recall/commit/d74be181b6b48aee771470867aa5b13406f4a149))


### Refactors

* API + DB hardening (1.0 plan section A) ([8471806](https://github.com/sound-barrier/recall/commit/84718060a8d36e46babf8c6b2892aab7b9327e55))
* **app:** nil-safe SSEHub broadcast removes teardown race ([63a41ab](https://github.com/sound-barrier/recall/commit/63a41ab311d1c8dc58342b38af29b55f3ce983dd))
* **log:** pkg/applog seam + watcher.go + server.go sweep (P2-E) ([94e8b0e](https://github.com/sound-barrier/recall/commit/94e8b0eb4d920a178b134b6a034ad2844b7a543e))
* **matches:** remove Campaign Log collapse-on-scroll ([3cac2df](https://github.com/sound-barrier/recall/commit/3cac2dffcdf88f70ac0102bb54a8f16ecce49510))
* **parser:** name magic numbers + audit-confirm doc comments ([ceaff20](https://github.com/sound-barrier/recall/commit/ceaff20eec1b51cffe468d4b1c5b269c9bb884f3))
* server-side helpers + invariants (1.0 plan section A) ([195e2e2](https://github.com/sound-barrier/recall/commit/195e2e2d335ef0abff611918257e6ff0f3b8adbd))
* **ui:** design system tightening (1.0 plan §C subset) ([6028a9b](https://github.com/sound-barrier/recall/commit/6028a9bdbf648ecc6a38a54076b4e1dd8e6c257e))


### Documentation

* add 1-0-RELEASE-PLAN.md (comprehensive pre-1.0 audit) ([03ef9b6](https://github.com/sound-barrier/recall/commit/03ef9b61d14d63a7aa75608891f7e329d976b4e4))
* add README troubleshooting section (1.0 plan §C) ([7a9b7bc](https://github.com/sound-barrier/recall/commit/7a9b7bce0b0efbec6b274843dfa102ca57cf4c23))
* audit split-large-components items (1.0 plan §C) ([8fd5c41](https://github.com/sound-barrier/recall/commit/8fd5c413ca73fe1a276dff84f1315ff14a1d8d7e))
* prep README + user docs for 1.0 ([f8a97b7](https://github.com/sound-barrier/recall/commit/f8a97b7f61b287dd29f094dfec5bccc53f34fb74))
* **release:** audit P1-G design-system items (2 done, 1 deferred) ([0e0fd6a](https://github.com/sound-barrier/recall/commit/0e0fd6ad6e8fb0fb753bf60cb0744693e082a5d4))
* **release:** P1-H large-Vue-split round-2 audit confirms defer ([cf85d59](https://github.com/sound-barrier/recall/commit/cf85d59a6d2ecea69ed05e18fb6da4a39996a993))
* **release:** roll P1/P2 follow-ups into 1-0-FOLLOWUPS.md ([adf6dfe](https://github.com/sound-barrier/recall/commit/adf6dfef56ed16313d956ebd110e63d4ce7afe4f))
* test-only API + no-telemetry sections (P2-D) ([b9dc044](https://github.com/sound-barrier/recall/commit/b9dc044f679b7e482a9c6c988103e25bf0ae7637))


### CI

* expand pre-push playwright smoke filter (P2-A) ([b3e0344](https://github.com/sound-barrier/recall/commit/b3e03440bfc2f23f0677553af634b7928505bd51))


### Tests

* **e2e:** add import roundtrip + prometheus toggle specs ([0fc58a5](https://github.com/sound-barrier/recall/commit/0fc58a59db86592ae8d11cdf7993a1259cb40702))
* **e2e:** high-contrast theme structural snapshot (P1-E) ([b3e59a7](https://github.com/sound-barrier/recall/commit/b3e59a7cb7ec7f3ec98049819e9f61ea31100e95))
* **e2e:** swap remaining narrow-text selectors to data attr ([1d4120b](https://github.com/sound-barrier/recall/commit/1d4120bf5e87618b41d031c5c9150ccebcd8a95c))
* **e2e:** update profile-delete spec for the new step label ([9372173](https://github.com/sound-barrier/recall/commit/93721736564a47deba86a02932a573be87dd7e52))
* **fuzz:** parser helpers + screenshot handler (P2-C) ([27e65e8](https://github.com/sound-barrier/recall/commit/27e65e82c7889fb732e1778fbdf183703ecea255))

## [0.11.0](https://github.com/sound-barrier/recall/compare/v0.10.0...v0.11.0) (2026-06-09)


### ⚠ BREAKING CHANGES

* GET /api/v1/system/update response no longer includes the `data` field; the `main` field is renamed to `game_data` and its schema MainStatus is renamed GameDataStatus. POST /api/v1/system/data-update no longer accepts a body and ignores the `source` discriminator. DataUpdateResult drops `source` and `applied_tag`. The Wails-exposed methods App.ApplyDataUpdate and App.ApplyMainDataUpdate are gone; the single survivor is App.ApplyGameDataUpdate.
* **db:** SQLite DBs from any prior release will fail to open against the new schema (the `schema_version` table reference is gone; legacy colon-form match_keys won't be rewritten). Pre-1.0 — no migration path. Wipe per CONTRIBUTING.md and relaunch.
* HTTP path params change from camelCase to snake_case; POST /screenshots/{filename}/ignore replaced by PUT; resolution invalid-target status changes from 409 to 400; DB columns distance_s and set_at renamed; screenshots_dir_id FKs are now RESTRICT not SET NULL (delete dependent rows first). Pre-1.0 — no migration path.

### Features

* **lefthook:** add whole-project lint sweep to pre-push ([9079567](https://github.com/sound-barrier/recall/commit/90795677c26b20b560d225ba3bd15e212713fb01))
* single "Update game data" button + diff preview manifest ([4ac2421](https://github.com/sound-barrier/recall/commit/4ac2421c8e9d4a346149ee87532fcd6403ea15f5))


### Bug Fixes

* **ci:** close two CI gates the prior commit tripped ([b419b71](https://github.com/sound-barrier/recall/commit/b419b71c6a2681ce67116c7541f074b0a216620f))
* **e2e:** two CI-only layout/transition flakes blocking PR [#248](https://github.com/sound-barrier/recall/issues/248) ([0125d6c](https://github.com/sound-barrier/recall/commit/0125d6c130b4958a8cebd6fe72bd888928056475))
* **lefthook:** port collision between schemathesis + playwright-smoke ([1b75bfe](https://github.com/sound-barrier/recall/commit/1b75bfeb92ff32ea644baf87278d38a421887cbf))


### Refactors

* **db:** drop migration framework for single-file schema ([b8a9cca](https://github.com/sound-barrier/recall/commit/b8a9cca94d06431f41a93b3bb7bf48d1a177c0a4))
* **db:** keep migration scaffolding, inert until 1.0 ([338ce73](https://github.com/sound-barrier/recall/commit/338ce73d2ff6e745d8bad38e7983e3bbc4c2bd99))
* pay down all 17 technical-debt items ([7561b71](https://github.com/sound-barrier/recall/commit/7561b711d634ad15c8a3377ba09d424d73334de6))


### Documentation

* **lefthook:** explicit "do not LEFTHOOK=0 to fix a blocked push" ([c63d5e2](https://github.com/sound-barrier/recall/commit/c63d5e2ebb75fcb05e7bb307a20ad726ac531afd))
* refresh UI_RECOMMENDATIONS audit signal post-completion ([c434c9b](https://github.com/sound-barrier/recall/commit/c434c9b92316f26171c20cfc75a44769ac0afef4))


### CI

* close the pre-push gap; zero-tolerance flake/skip policy ([95b5dba](https://github.com/sound-barrier/recall/commit/95b5dba465202f56630b33c9ae4ff1c3e0dad07d))


### Tests

* **e2e:** scope update-check selectors so success state stops 2-matching ([6f868fc](https://github.com/sound-barrier/recall/commit/6f868fc65433265e91209e5a5d2ea0a6d6e3e34f))

## [0.10.0](https://github.com/sound-barrier/recall/compare/v0.9.1...v0.10.0) (2026-06-09)


### ⚠ BREAKING CHANGES

* **updates:** parser.HeroesByRole / parser.MapsByType / parser.ScreenshotSources package vars become parser.HeroesByRole() / .MapsByType() / .Sources() accessor functions so the dataset can swap atomically. /api/v1/system/update grows a required `data` field carrying the diff against the user's applied manifest; /api/v1/system/data-update is the new POST endpoint that applies a release's YAMLs in-place.
* **api:** GET /api/v1/system/screenshots-folder-probe and the Wails-bound ProbeScreenshotsDir method have been removed. Callers should switch to GET /api/v1/system/screenshots-folder- candidates (or the Wails ProbeScreenshotsCandidates method) and pick the first entry whose `exists` field is true. macOS / Linux return an empty list — auto-detect is Windows-only by design.
* **parser:** MatchResult JSON shape gains hero_raw + map_raw fields; UnknownMapsView's referenceGapRecords prop is required (no optional default); migration 0006 adds new columns to three parent screenshot tables; POST /api/v1/parses takes a new ?scope=all query branch. No existing user data to migrate (pre-release posture), but any downstream consumer keying off the old wire shape breaks. release-please picks this up for the next minor cut pre-1.0.

### Features

* **api:** remove ProbeScreenshotsDir endpoint ([95eb1a7](https://github.com/sound-barrier/recall/commit/95eb1a7b7a609953a9792ac81f56228b90acd8b1))
* **matches:** bulk-tag from selected rows (item 3) ([10a51d2](https://github.com/sound-barrier/recall/commit/10a51d283c7ae800f6d13f8e6f17629c25f15241))
* **matches:** extend right-click menu with 5 actions (item 7) ([da2c3d1](https://github.com/sound-barrier/recall/commit/da2c3d138890fa18f9b122c25437872efc3b4958))
* **matches:** Hero × map-type heatmap dossier widget (item 2) ([ec54739](https://github.com/sound-barrier/recall/commit/ec54739e98171a15e4083d79a0a72947f818f7eb))
* **matches:** inline tag autocomplete in Match Journal (item 5) ([e65de95](https://github.com/sound-barrier/recall/commit/e65de9576f0fa6e677d29e8d52a8a4dbef11f670))
* **matches:** leaf-row hover preview (item 4) ([ce5c29c](https://github.com/sound-barrier/recall/commit/ce5c29c5758b6a7311028c40c647a04067a31ace))
* **matches:** leaf-row virtualization wired into the flat-mode list (item 1) ([0244487](https://github.com/sound-barrier/recall/commit/0244487aed45dfe8115395f10e71a89e6d89dbbc))
* **matches:** saved-set / preset feature (item 8) ([a4761b2](https://github.com/sound-barrier/recall/commit/a4761b2f2a687a49cd4bd4be88b3f14a7449ba38))
* **matches:** smart-empty filter suggestions (item 6) ([fe68db5](https://github.com/sound-barrier/recall/commit/fe68db5c32ddeca009eaeee1e67c866b1ad6915f))
* **matches:** useVirtualWindow primitive (item 1 partial — integration deferred) ([eed6f06](https://github.com/sound-barrier/recall/commit/eed6f0699d0ced5642b43242a3070399e406d6c1))
* **onboarding:** contextual callout on reference-data-gaps (item 13 surface C) ([8a1f3ba](https://github.com/sound-barrier/recall/commit/8a1f3ba7f864cce59d005215e873e52e07c96853))
* **onboarding:** contextual callout on the screenshot-source picker (item 13 surface B) ([ab76030](https://github.com/sound-barrier/recall/commit/ab76030a08d30af1ff5af1c04b7d581fec76ac8c))
* **onboarding:** contextual-callout primitive (item 13 prep) ([cdd6f75](https://github.com/sound-barrier/recall/commit/cdd6f750a0df7b1de55f8bc3d0c72a2d55c7d4d9))
* **onboarding:** first-run modal multi-step picker (item 14) ([f50d6c8](https://github.com/sound-barrier/recall/commit/f50d6c8d2d5de87da03d91e9b61f3eb02812c15b))
* **onboarding:** rewrite set-workspace tour copy (item 13 surface A) ([919c576](https://github.com/sound-barrier/recall/commit/919c57683f909f7182ae4f7f85974cb5e1b48cde))
* **parse:** re-parse "matches updated" progress (item 12) ([f76f1b5](https://github.com/sound-barrier/recall/commit/f76f1b5495d005c6f4ecc60e4023395ac04c0eed))
* **parser:** extract filenameFormats to embedded YAML + release asset ([22d678d](https://github.com/sound-barrier/recall/commit/22d678d01e4647726e69b65e4d1a368e7d75d999))
* **parser:** recognise PrntScn + Win Snip screenshot filename formats ([9a153e2](https://github.com/sound-barrier/recall/commit/9a153e2928c3acfd9880a62f9556fb4bae28f2ac))
* **parser:** recognise Steam F12 screenshot filenames (4th source) ([03b5291](https://github.com/sound-barrier/recall/commit/03b5291e297053684d4de2dc8827b48921f4c380))
* **parser:** reject short-name fuzzy matches; surface OCR'd Unknown heroes/maps ([0741322](https://github.com/sound-barrier/recall/commit/074132275c6ca021cc8258dfa3d5d1360849371a))
* **release:** publish heroes.yaml + maps.yaml as attested release assets ([bfea6ca](https://github.com/sound-barrier/recall/commit/bfea6ca21aacac7a883b45709af631ecc7b0aecc))
* **settings:** per-source diagnostics on the picker grid (item 9) ([f267825](https://github.com/sound-barrier/recall/commit/f267825b40e5d1cf9dc6228317f142b9720bc742))
* **settings:** supported filename formats surface (item 10) ([cae86dc](https://github.com/sound-barrier/recall/commit/cae86dcd0b7db009fbf298f474fc561a19dedb4a))
* **settings:** Windows screenshot source picker with four named sources ([0e01210](https://github.com/sound-barrier/recall/commit/0e01210028d5b7ae8b6358f27b0d5197aebf3f42))
* **unknown:** "Fixed in vX.Y.Z" CTA on reference-data-gap cards (item 11) ([476b66e](https://github.com/sound-barrier/recall/commit/476b66ef0858fc3316e45da0fe4655d7d9757744))
* **updates:** publish heroes/maps/sources from main as a live data channel ([4658c55](https://github.com/sound-barrier/recall/commit/4658c55fc4b8941657fe6c2ebfa7a3be5899cecd))
* **updates:** replace silent roster fetch with explicit modal + reminder ([afb7e24](https://github.com/sound-barrier/recall/commit/afb7e249c51ea315eb4487676419478b080887f5))


### Bug Fixes

* **api:** drop double URL-decode on screenshots/{filename}/ignore + close vue-tsc readonly array ([8541132](https://github.com/sound-barrier/recall/commit/8541132c11c8adaad8b1cdcbbefe37825d2cef32))
* **fixtures:** chaos categories for missing play_mode + queue_type (coverage gap) ([0760867](https://github.com/sound-barrier/recall/commit/0760867675fd8c1386f27b369ad59dd73e575348))
* **lint:** drop unused vi import + reflow callout buttons for vue-html lint ([595ab3b](https://github.com/sound-barrier/recall/commit/595ab3b51238bec46e2e534fd70e5c602431d1b4))
* **matches:** restore right-click context menu after broken records ref ([2238960](https://github.com/sound-barrier/recall/commit/223896082b241cb7796191f0650d83f7b85661dc))
* **onboarding:** drop the global tour-completed gate on contextual callouts ([dd50251](https://github.com/sound-barrier/recall/commit/dd50251d2ae193dfdb01b99f539e68b1ebc2e5de))
* **types:** close vue-tsc errors uncovered by the lint CI job ([453f4a5](https://github.com/sound-barrier/recall/commit/453f4a57a5febdb1e55258ad1889e9a685c4f247))
* **updates:** scope modal e2e selectors + stylelint blank-line cleanup ([5ae68b6](https://github.com/sound-barrier/recall/commit/5ae68b676947aee898bdaf1849b3d149b215bb90))


### Refactors

* **db:** derive latestMigrationVersion in migrate_test.go ([0016e93](https://github.com/sound-barrier/recall/commit/0016e9326ecb3243c9ddd48e45d0d95b334687e2))
* **frontend:** extract TypeaheadDropdown primitive ([57699f6](https://github.com/sound-barrier/recall/commit/57699f622dfe0d5c33ebf4961dd480e9e9522248))
* **frontend:** split match-helpers.ts by topic ([aa1d264](https://github.com/sound-barrier/recall/commit/aa1d264181d7fc5135339867f8e3025acfe1ffda))


### Documentation

* feature sweep for recent updates flow + 17 tech-debt items + PR-only rule ([120beb1](https://github.com/sound-barrier/recall/commit/120beb15b584e017a7e6d3b4980e1698cd9d8dbe))
* post-PR-227 sweep across README + docs + debt + UI backlog ([e93301b](https://github.com/sound-barrier/recall/commit/e93301b72c235cc404c5eb232178e3caf2c76957))


### Tests

* **matches:** fix e2e chip-selector to match actual class names ([fb0d365](https://github.com/sound-barrier/recall/commit/fb0d36521c19f82455204d8efc59684a3c4b270b))
* **matches:** make leaf-virtualization scroll test environment-independent ([ea0419a](https://github.com/sound-barrier/recall/commit/ea0419a7447424d31157f707038774b3534d583e))
* **matches:** switch leaf-virtualization e2e to the real sort/group popover selectors ([0ee8435](https://github.com/sound-barrier/recall/commit/0ee8435843eb826e099a86f959fd62a2ca9e851e))
* **matches:** unit tests for useNarrowPresets / useSummaryThumbnail / MatchesEmptySuggestions ([fa2ddaf](https://github.com/sound-barrier/recall/commit/fa2ddaf7cfa5638b72f35781c5ddf93da98b03a5))
* **settings:** mock api in SettingsAdvanced.test for useOWData fetch ([475ecb5](https://github.com/sound-barrier/recall/commit/475ecb5ca399f1bbcde11b8ffdc6205d5aad9115))
* **unknown:** e2e clicks the masthead button by role, not title ([1d6bd18](https://github.com/sound-barrier/recall/commit/1d6bd1843e64157a69331e3203ebeabd68290922))
* **unknown:** mock /_screenshot/** in auto-open preview spec to kill CI flake ([8b8f845](https://github.com/sound-barrier/recall/commit/8b8f84560c88a9e1056695597f6a0dab7731890a))

## [0.9.1](https://github.com/sound-barrier/recall/compare/v0.9.0...v0.9.1) (2026-06-08)


### Features

* **matches:** bulk-set play-mode + queue-type on the selected rows ([7a0d818](https://github.com/sound-barrier/recall/commit/7a0d81837a2d13ed76d1ff23f6f6694be2929595))
* **matches:** harmonize sort / density / jump controls onto a shared button-row shape ([fd33a4c](https://github.com/sound-barrier/recall/commit/fd33a4c294ee9a095f46f428b4261f7271314092))
* **matches:** leaf ↔ chooser ↔ filter all read the same play-mode bucket ([92b09f6](https://github.com/sound-barrier/recall/commit/92b09f63c27dcddad2a79d23b16013c68d5ea56d))
* **matches:** leaf row carries a queue-type chip next to the play-mode chip ([474829b](https://github.com/sound-barrier/recall/commit/474829b775940818fbf6477aaa08b69f2aa32f19))
* **matches:** scroll-to-top button + jump-to-undated affordance ([dc7d258](https://github.com/sound-barrier/recall/commit/dc7d258ba88d683adf83de737b38b585dc58cc69))


### Bug Fixes

* **ci:** disable schemathesis negative_data_rejection — flaky on DELETE matches ([e063088](https://github.com/sound-barrier/recall/commit/e063088604915ccf18205bd6f3bb8de21c128014))
* **matches:** jump-to-undated expands the window so the "No date" section reaches the DOM ([2fa704c](https://github.com/sound-barrier/recall/commit/2fa704cdf5a7ee8f2d68eff82b29c7555e12d9eb))
* **matches:** jump-to-undated lands the section header below the sticky Campaign Log ([05fb04d](https://github.com/sound-barrier/recall/commit/05fb04d32c941480d5c2978dd1fc82826ced3680))
* **matches:** open-queue leaf row lists every role the player touched, not just primary ([6b982ce](https://github.com/sound-barrier/recall/commit/6b982ce0fc6651eca89bbc1436ae4b01c92de8a9))
* **release-please:** fail loudly when the label-flip lookup returns empty ([d314308](https://github.com/sound-barrier/recall/commit/d31430819d93356190543431f27177e97c901f6f))

## [0.9.0](https://github.com/sound-barrier/recall/compare/v0.8.0...v0.9.0) (2026-06-05)


### Features

* **dev:** chaos seeding via CHAOS=&lt;0..1&gt; on make seed-dev ([c988dd5](https://github.com/sound-barrier/recall/commit/c988dd58710315f1d99d3d8dff595fc072551b0b))
* **dev:** default seed-dev to flex + cover every map and hero ([acfcdc2](https://github.com/sound-barrier/recall/commit/acfcdc2bb7e301f2d5e71567c5aaa830d0a13268))
* **dev:** realistic seed-dev distribution + make seed-clear / SEED=time ([9e12982](https://github.com/sound-barrier/recall/commit/9e12982c1988142039bb0fd947348ee096d80e1c))
* **dev:** seed-dev covers the full canonical OW roster ([bb0c7ee](https://github.com/sound-barrier/recall/commit/bb0c7ee84c4c3b558c9b1a5829062f1c1c58e3f4))
* **dev:** seed-dev draws realistic W/L/D + ~1.5% reviewed matches ([c69f729](https://github.com/sound-barrier/recall/commit/c69f7297844a02f20a324a4dfeb63af0bd310d46))
* **dev:** seed-dev models 1-4 hero swaps per match ([66d8cac](https://github.com/sound-barrier/recall/commit/66d8cac7df61e2b7831869f81ac103dfeca90d90))
* **dev:** seed-dev models real screenshot coverage gaps ([49d6f50](https://github.com/sound-barrier/recall/commit/49d6f502a5f547fa6f76aa570275aaf188502a8f))
* **dev:** seed-dev tool for populating a profile with synthetic matches ([371f96b](https://github.com/sound-barrier/recall/commit/371f96b272e31da3cb10c070c4edb334666ead8d))
* **dev:** seed-dev writes companion PNGs for ambiguous screenshots ([3e6f88b](https://github.com/sound-barrier/recall/commit/3e6f88b15de1258b113e9209471f93652e81616e))
* **dossier:** non-default widgets for play-mode share + winrate ([a306866](https://github.com/sound-barrier/recall/commit/a306866a14a7fd0c7cd708a104df25c865bc6b39))
* **matches:** combined Sort + Group dropdown above the leaves list (PR 6) ([8a777f1](https://github.com/sound-barrier/recall/commit/8a777f1073c5321e5dc2833e3c84bd2affd04b1a))
* **matches:** density toggle for the leaves list (PR E) ([82a9c7d](https://github.com/sound-barrier/recall/commit/82a9c7d2bcb65ebcac574f9720f7c28c24362c38))
* **matches:** persistent filter rail at ≥1400 px (PR 7) ([14ec846](https://github.com/sound-barrier/recall/commit/14ec846d8d96201c6303877f85a5115b579fe609))
* **matches:** quickplay/competitive play-mode toggle + narrow filter ([6219e6b](https://github.com/sound-barrier/recall/commit/6219e6b609babdf3f1abb42868bec9c0b6feec60))
* **matches:** role/open queue type per match — toggle + narrow filter ([096b8f0](https://github.com/sound-barrier/recall/commit/096b8f0ace10be91d335e63a558a5d6a5ed46c92))
* **matches:** sticky Campaign Log with compact-when-sticky (PR 5) ([f198de8](https://github.com/sound-barrier/recall/commit/f198de8aa997254e63eeda16ad3ac641fe93d60e))
* **styles:** tokenize spacing / type / motion (PR A of the design-system pass) ([256a8bd](https://github.com/sound-barrier/recall/commit/256a8bdba9e23999c89ecb293d0a4a294082e1ac))
* **unknown:** "Delete forever" suppress-list with new screenshots API (PR 4) ([0b1d9f3](https://github.com/sound-barrier/recall/commit/0b1d9f3f79bbdb4b5eb39f3b0cbdad1a9a0541e6))
* **unknown:** hover thumb + click-to-lightbox on Manage ignored panel ([807a889](https://github.com/sound-barrier/recall/commit/807a889aad0b3fddfd4436770928da612b6c2f81))
* **unknown:** in-page section nav + record deferred design-pass items (PR F) ([9f1a8f6](https://github.com/sound-barrier/recall/commit/9f1a8f6fdb48e78efd84e6e65522b33e14b58654))
* **unknown:** long-press touch fallback for the hover thumbnail (PR 2) ([301ae4a](https://github.com/sound-barrier/recall/commit/301ae4a79866c72329229c7a5744db0803041c0e))
* **unknown:** restore "Delete forever"d screenshots from Settings ([624a771](https://github.com/sound-barrier/recall/commit/624a771ced921470231e9033016cc4832edae345))
* **unknown:** side-by-side candidate preview + auto-open source on expand ([7560f0a](https://github.com/sound-barrier/recall/commit/7560f0afdaaafd8c76ec7308bdd60312f87baaf7))
* **unknown:** visual candidate thumbnails in the ambiguous picker (PR 3) ([9512d6b](https://github.com/sound-barrier/recall/commit/9512d6b9655ae4cab1bf4b2680707d115ab815b0))


### Bug Fixes

* **a11y:** day-theme color-contrast pass — close TECHNICAL_DEBT.md #20 ([c085321](https://github.com/sound-barrier/recall/commit/c0853214df80caafd1052688f8d24777846ea940))
* **a11y:** defer day-theme axe to follow-up; route seg-btn through text-on-accent token ([24ea0a1](https://github.com/sound-barrier/recall/commit/24ea0a1df4bdfa0ef716029fb81bea115f762858))
* **a11y:** light-text override for .alert-cta in day theme ([e730173](https://github.com/sound-barrier/recall/commit/e7301732c5d2fb03d3410d247022cb330db1b610))
* **a11y:** touch targets / live regions / form polish / themed axe (PR C) ([01e0d69](https://github.com/sound-barrier/recall/commit/01e0d691ef18456c054e95e30f3deda16a3da67b))
* **api:** drop the strict pattern; rely on minLength/maxLength only ([94f29a1](https://github.com/sound-barrier/recall/commit/94f29a1ed8370fd4e5ffb1eb8cf478a3dde26c56))
* **api:** drop unused default: false on keep_ignored param ([1ac2094](https://github.com/sound-barrier/recall/commit/1ac20943f347610c488a4229d8730aa29cb5a391))
* **api:** handler-side filename pattern validation matches the spec ([6319c6e](https://github.com/sound-barrier/recall/commit/6319c6e59c77dae92448de998bd73a2f6aa64a64))
* **db:** Store.Clear must wipe match_reviews + annotations + hidden + ambiguous ([a1664e8](https://github.com/sound-barrier/recall/commit/a1664e8180f6573537147b8893ba98f424c6101a))
* **dev:** role-queue matches lock the player to one role ([2d78dbb](https://github.com/sound-barrier/recall/commit/2d78dbb05c25e0de1a921f9eb01b6e6bf17e0282))
* **lint:** drop the unused POPOVER_WIDTH_ESTIMATE constant ([7787199](https://github.com/sound-barrier/recall/commit/77871994a5b805d8f862afad273622f99bc1c92a))
* **matches:** MatchDetailPanel re-emits set-match-queue + set-match-play-mode ([8a69fd8](https://github.com/sound-barrier/recall/commit/8a69fd8d71f8c84fb022da9f2692e91080812752))
* **matches:** play_mode is override-only — "Not set" defaults + sticks ([6e1af69](https://github.com/sound-barrier/recall/commit/6e1af69f9c6730cbb16540a6cf963727e4403d5f))
* **security:** reject path separators + NUL in screenshot filenames ([30fccc1](https://github.com/sound-barrier/recall/commit/30fccc1bd40539b602fc5974b0bb5b8bb3bfde66))
* **unknown:** Delete forever wipes the actual match_key, not just unmatched-/ambiguous- ([2588dfb](https://github.com/sound-barrier/recall/commit/2588dfb638600dce4dc50be1232f92059805b773))


### Refactors

* **shell:** commit to numbered-tab typesetting + dialog landmark (PR D) ([cddcea4](https://github.com/sound-barrier/recall/commit/cddcea4e32fa0b10252861ad81795d33b3cadf43))


### Documentation

* **debt:** record day-theme axe pass as item 20 ([bb693b5](https://github.com/sound-barrier/recall/commit/bb693b5d622df7c930feafc7f845b03805112745))

## [0.8.0](https://github.com/sound-barrier/recall/compare/v0.7.0...v0.8.0) (2026-06-04)


### ⚠ BREAKING CHANGES

* **dashboard:** refactor widgets to inject dossier + populate schemas (PR C)
* **dossier:** query-layer refactor + useDossier inject helper (PR B)
* **dashboard:** schema foundation for per-widget config (PR A)

### Features

* **dashboard:** gear icon + WidgetConfigPopover (PR D) ([2c9f52f](https://github.com/sound-barrier/recall/commit/2c9f52fd743154b1899227ffa7c06f0e192c051a))
* **dashboard:** refactor widgets to inject dossier + populate schemas (PR C) ([de8be92](https://github.com/sound-barrier/recall/commit/de8be9292ded30b316355f42c67eb9307fef431e))
* **dashboard:** schema foundation for per-widget config (PR A) ([3ba2743](https://github.com/sound-barrier/recall/commit/3ba27431c945519a95e048fff9f18a9afb92dc21))
* **dashboard:** show the widget gear independent of edit mode ([f420e45](https://github.com/sound-barrier/recall/commit/f420e4527a6d255abcd6f07bb682b897af4ac22b))
* **dossier:** query-layer refactor + useDossier inject helper (PR B) ([a4c8633](https://github.com/sound-barrier/recall/commit/a4c86339d4a8a56ed2ade5e14943e1d534b57a8a))


### Bug Fixes

* **dashboard:** flip widget-config popover above the gear near the viewport bottom ([3400b94](https://github.com/sound-barrier/recall/commit/3400b941f6944fed06f26aeed72152def348b461))


### Documentation

* **dashboard:** close out the widget-config refactor (PR E) ([d3bba4c](https://github.com/sound-barrier/recall/commit/d3bba4c3c26d0ce82f83566f3bf9f0af58b8cd70))
* drop stale TECHNICAL_DEBT.md item references from code comments ([91f84cb](https://github.com/sound-barrier/recall/commit/91f84cb3de4c96ff02f624ba065f5c8c955ac699))


### Tests

* **cmd:** handler gap coverage for /matches routes ([37b59c4](https://github.com/sound-barrier/recall/commit/37b59c4d2ad119acb04597567dcb8b84418e73f3))

## [0.7.0](https://github.com/sound-barrier/recall/compare/v0.6.0...v0.7.0) (2026-06-04)


### ⚠ BREAKING CHANGES

* **app:** cancel-in-flight parse via ctx seam + parse-cancelled SSE

### Features

* **api:** DELETE /api/v1/parses/active cancels an in-flight parse ([e79e847](https://github.com/sound-barrier/recall/commit/e79e84749818ca3231c0d48967029f5710d09776))
* **api:** expose GetStartupError on App + GET /api/v1/system/startup-error ([830888e](https://github.com/sound-barrier/recall/commit/830888e3cf234c5b2b4c3c37eea5ca2a3d82c46a))
* **app:** blocking startup-error modal in App.vue ([cd4e46d](https://github.com/sound-barrier/recall/commit/cd4e46d188935feb125529041ad070e04c1fc52c))
* **app:** cancel-in-flight parse via ctx seam + parse-cancelled SSE ([f3e16cf](https://github.com/sound-barrier/recall/commit/f3e16cf2e98207eec7c67d85445eceeec8412e7c))
* **ingest:** Stop button + cancelling state + parse-cancelled wiring ([835de3a](https://github.com/sound-barrier/recall/commit/835de3a7fe4a53dfe373dfba98bb39ee5d894653))
* **matches:** client-side window + IntersectionObserver infinite-scroll ([d6a73fb](https://github.com/sound-barrier/recall/commit/d6a73fb4d2a993907cf3abbfb1ea81bf376639c5))
* **status-bar:** ABORT tile — global Stop from any tab ([25804ea](https://github.com/sound-barrier/recall/commit/25804ea25ded9149cf09976bdf28f896518d8ddb))


### Bug Fixes

* **api:** reject `?limit=` (present-but-empty) on GET /api/v1/matches ([3ed9935](https://github.com/sound-barrier/recall/commit/3ed9935000f6f63fbfe073d9521d2174d2e9f036))
* **matches:** drop dead `used = cap` in windowedSections overflow branch ([e6e9f83](https://github.com/sound-barrier/recall/commit/e6e9f832869980eb76eabec9b36ddbea07481be3))


### Refactors

* **app:** extract useGlobalKeyboard composable ([6b3210d](https://github.com/sound-barrier/recall/commit/6b3210de7c0c295798c17d0d1e0a7e30f264bec5))
* **matches:** extract BulkActionBar from MatchesView ([6cf5288](https://github.com/sound-barrier/recall/commit/6cf528854f5c4c4a2ed49eeeb174c40a7587e082))
* **matches:** extract NarrowPopover from MatchesView ([12c40b3](https://github.com/sound-barrier/recall/commit/12c40b3bb31c8522b6fb9f7739c8012ce32c2ff6))
* **matches:** lazy-load NarrowPopover into its own chunk ([22594d5](https://github.com/sound-barrier/recall/commit/22594d57a99e07c4408e3898b89935d9f91dcc2a))


### Documentation

* **debt:** add [#15](https://github.com/sound-barrier/recall/issues/15) — cancel-in-flight parse ([af355cb](https://github.com/sound-barrier/recall/commit/af355cbc77b95f08e68e811d772fec8f0959981a))
* **debt:** close [#7](https://github.com/sound-barrier/recall/issues/7) as intentional design — POST /parses stays ([0b9a8d1](https://github.com/sound-barrier/recall/commit/0b9a8d1f75cfb7b8c6af02c3eb3802fa18d45cf0))
* **debt:** finish [#12](https://github.com/sound-barrier/recall/issues/12) — bundle audit cadence + drop item ([fdd0071](https://github.com/sound-barrier/recall/commit/fdd007160e326949d675c049d026e212a5ff3aec))
* **debt:** finish [#15](https://github.com/sound-barrier/recall/issues/15) — cancel-in-flight parse ships ([dee51ca](https://github.com/sound-barrier/recall/commit/dee51ca554f01864f9c2f32754cd5a61f41ed682))
* **debt:** finish [#4](https://github.com/sound-barrier/recall/issues/4) — SFC split paid down across 3 commits ([b7575a4](https://github.com/sound-barrier/recall/commit/b7575a43bf5bb95db8aca2521606e7cea805c1ce))
* **debt:** finish [#6](https://github.com/sound-barrier/recall/issues/6) — frontend window ships, list view paginates ([b821980](https://github.com/sound-barrier/recall/commit/b8219804d97cb347cadfb1e5f239748332a72e6e))
* **debt:** finish [#8](https://github.com/sound-barrier/recall/issues/8) — drop item, log.Fatal startup paths fully covered ([49d3bb4](https://github.com/sound-barrier/recall/commit/49d3bb474e6883ed44cae8e625c64eded77ea14c))
* **debt:** populate TECHNICAL_DEBT.md with 14-item audit ([a725582](https://github.com/sound-barrier/recall/commit/a725582f1d5eb80c8c413fa6833dd99f8fcd3557))


### CI

* McCabe complexity sweep (gocyclo + eslint) — report-only ([13508ec](https://github.com/sound-barrier/recall/commit/13508ec69bfe983690e427a87b6f217dc9492849))


### Tests

* **cancel-parse:** correct tesseract-status mock URL ([b105254](https://github.com/sound-barrier/recall/commit/b105254b1ab98366a4729ad2bef2e6fbf3fd1608))
* **ingest:** playwright e2e for cancel-parse flow ([77d758b](https://github.com/sound-barrier/recall/commit/77d758b721566c95698c87ed61a357ad7a367f9f))
* **matches:** playwright e2e for infinite-scroll window ([91ca1ce](https://github.com/sound-barrier/recall/commit/91ca1ce7283145b17652448445d6bba03d498fb7))

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
