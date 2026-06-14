package app

import "recall/pkg/probe"

// ProbeScreenshotsCandidates is the Wails-bound view of the screenshots-folder
// candidate probe; it delegates to pkg/probe.
func (a *App) ProbeScreenshotsCandidates() []probe.NamedCandidate {
	return probe.ScreenshotsCandidates()
}

// ProbeScreenshotsCandidateStats is the Wails-bound per-source diagnostic probe.
func (a *App) ProbeScreenshotsCandidateStats() []probe.NamedCandidateStats {
	return probe.ScreenshotsCandidateStats()
}

// autoProbeOnFirstRun is called from Startup when settings carry no screenshots
// dir. Quietly applies the probe result so a fresh install finds the OW folder
// without forcing the user through the picker.
func (a *App) autoProbeOnFirstRun() {
	if a.settings.ScreenshotsDir != "" {
		return
	}
	path, ok := probe.FirstExistingCandidate()
	if !ok {
		return
	}
	a.settings.ScreenshotsDir = path
	a.saveSettingsBestEffort()
}
