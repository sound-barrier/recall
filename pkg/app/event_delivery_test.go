package app_test

import (
	"testing"

	"recall/pkg/app"
)

// A state event is never superseded: nothing re-sends "a coaching session
// opened" or "Tesseract was found". Sent best-effort, a client whose buffer
// a progress burst had filled lost it for good — the second window kept
// offering edits the server refused, or the engine banner never cleared.
func TestStateEvents_SurviveAFullBuffer(t *testing.T) {
	cases := map[string]func(a *app.App){
		"coach-session-changed": func(a *app.App) { app.EmitCoachSessionChanged(a) },
		"tesseract-status":      func(a *app.App) { app.EmitTesseractStatus(a, app.TesseractStatus{Found: true}) },
	}
	for name, emit := range cases {
		t.Run(name, func(t *testing.T) {
			a := app.New()
			a.SSEHub = app.NewSSEHub()
			ch := a.SSEHub.Subscribe()
			for range 64 {
				a.SSEHub.BroadcastData("parse-progress", "{}")
			}
			emit(a)
			for {
				select {
				case msg := <-ch:
					if msg.Event == name {
						return
					}
				default:
					t.Fatalf("%s was dropped on a full buffer", name)
				}
			}
		})
	}
}
