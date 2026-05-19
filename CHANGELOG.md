# Changelog

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
