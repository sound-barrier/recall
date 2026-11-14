package app

import "recall/pkg/parser"

// Recognized non-match screens — the PERSONAL "All Heroes" aggregate and the
// career HISTORY list — are parse successes that store only a filename in a
// skip registry. They share one policy, set here:
//
//   - no match correlation: they belong to no match, and a history list
//     captured between two games could otherwise tie the timestamp window
//     and be filed as an ambiguous screenshot waiting on the user;
//   - no typed-row eviction: a probe that misfires on a real screen must not
//     cost its data (a rowless, skip-listed file whose misread repeats on
//     every re-parse);
//   - the Unknown row does go: it claims nothing, and recognizing the screen
//     is exactly what it was waiting for.

func isRecognizedNonMatch(t parser.ScreenshotType) bool {
	return t == parser.TypeAllHeroes || t == parser.TypeHistory
}

// handleRecognized is handleFile's path for a recognized non-match screen.
func (st *parseRunState) handleRecognized(filename string, result *parser.MatchResult, ev ParseProgressEvent) {
	a := st.app
	if err := a.insertParsed(filename, "", ev.Type, st.dirID, result); err != nil {
		ev.Error = "insert: " + err.Error()
		st.recordLeakedFailure(filename, ev.Error)
		st.filesFailed++
		a.emitParseProgress(ev)
		return
	}
	st.filesParsed++
	st.reconcileFailureLedger(filename, result)
	st.applyToSnapshot(filename, "", ev.Type, result)
	st.applyAmbiguityToSnapshot(filename, nil)
	a.emitParseProgress(ev)
}

// recordRecognized retires the file's Unknown state and registers it.
func (a *App) recordRecognized(filename string, t parser.ScreenshotType) error {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	if err := store.DeleteUnknownScreenshot(filename); err != nil {
		return err
	}
	if t == parser.TypeHistory {
		return store.UpsertHistoryScreenshot(filename)
	}
	return store.UpsertAllHeroesScreenshot(filename)
}
