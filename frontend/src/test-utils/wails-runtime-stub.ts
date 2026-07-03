// Inert stand-in for '@wailsio/runtime' under Vitest (wired via
// resolve.alias in vitest.config.ts). The real module schedules a
// module-level setTimeout on import (dist/drag.js — the v3 window-
// drag handler) that can fire AFTER happy-dom tears the environment
// down, crashing the whole run with an uncaught
// "ReferenceError: window is not defined" even though every test
// passed (struck PR #549's CI). Unit tests never exercise real Wails
// IPC — IS_WAILS is false under happy-dom — so the runtime's only
// observable behavior here was that leaked timer.
//
// Only the names api.ts imports need to exist; calls throw so a test
// that accidentally routes down the Wails path fails loudly instead
// of silently no-oping.

function refuse(name: string): never {
  throw new Error(`@wailsio/runtime stub: ${name} must not be called in unit tests (IS_WAILS is false)`)
}

export const Browser = {
  OpenURL: (): never => refuse('Browser.OpenURL'),
}

export const Call = {
  ByName: (): never => refuse('Call.ByName'),
}

export const Events = {
  On: (): never => refuse('Events.On'),
  Off: (): never => refuse('Events.Off'),
  Emit: (): never => refuse('Events.Emit'),
}
