package cmd_test

import (
	"net/http"
	"net/url"
	"os"
	"regexp"
	"testing"

	"gopkg.in/yaml.v3"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/parser"
)

// PUT/DELETE /api/v1/matches/{match_key}/field-confirmations/{field} — the
// Unknown tab's "Confirm as read". The server binds the confirmation to the
// value the match reads now; the body's value is what the client showed, a
// precondition only.

const confirmKey = "match-2026-06-07T23-00-04"

// seedConfirmableMisread stores a SUMMARY whose eliminations total (74) its
// own rate over the minutes played disowns (9), so the read path flags it.
func seedConfirmableMisread(fs *dbtest.Fake) {
	fs.Summaries = append(fs.Summaries, db.SummaryRow{
		Filename: "ScreenShot_26-06-07_23-00-04-000.jpg", MatchKey: confirmKey,
		Hero: "lucio", Result: "victory", GameLength: "15:45",
		Eliminations: 74, Assists: 10, Deaths: 5,
		PerfElimAvgPer10Min: 12.97, PerfAssistsAvgPer10Min: 14.41, PerfDeathsAvgPer10Min: 7.21,
		HeroesPlayed: []db.SummaryHeroPlayed{{Hero: "lucio", PercentPlayed: 100, PlayTime: "06:56"}},
	})
}

// shown is the PUT body: the value the client showed the user.
func shown(value string) map[string]string { return map[string]string{"value": value} }

func confirmationURL(key string, field parser.FieldPath) string {
	return "/api/v1/matches/" + key + "/field-confirmations/" + url.PathEscape(string(field))
}

func TestPutFieldConfirmation_StoresTheValueOnScreen(t *testing.T) {
	fs := dbtest.New()
	seedConfirmableMisread(fs)
	_, mux := newTestApp(t, fs)

	rec := put(t, mux, confirmationURL(confirmKey, parser.ScalarPath("eliminations")), shown("74"))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %q", rec.Code, rec.Body.String())
	}
	if got := fs.ConfirmedReadings[confirmKey][parser.ScalarPath("eliminations")]; got != "74" {
		t.Errorf("confirmed value = %q, want 74; stored = %v", got, fs.ConfirmedReadings)
	}
}

func TestPutFieldConfirmation_Refusals(t *testing.T) {
	fs := dbtest.New()
	seedConfirmableMisread(fs)
	_, mux := newTestApp(t, fs)

	elims := confirmationURL(confirmKey, parser.ScalarPath("eliminations"))
	for name, tc := range map[string]struct {
		path string
		body any
		want int
	}{
		"unknown match":          {confirmationURL("match-2030-01-01T00-00-00", parser.ScalarPath("eliminations")), shown("74"), http.StatusNotFound},
		"a field without a flag": {confirmationURL(confirmKey, parser.ScalarPath("deaths")), shown("74"), http.StatusConflict},
		"a value since re-read":  {elims, shown("47"), http.StatusConflict},
		"no body":                {elims, nil, http.StatusBadRequest},
		"no value":               {elims, map[string]string{}, http.StatusBadRequest},
		"not a data path":        {confirmationURL(confirmKey, "eliminations"), shown("74"), http.StatusBadRequest},
		"an upper-case path":     {confirmationURL(confirmKey, "data.Eliminations"), shown("74"), http.StatusBadRequest},
	} {
		t.Run(name, func(t *testing.T) {
			if rec := put(t, mux, tc.path, tc.body); rec.Code != tc.want {
				t.Errorf("status = %d, want %d; body = %q", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
	if len(fs.ConfirmedReadings) != 0 {
		t.Errorf("a refused confirmation stored %v", fs.ConfirmedReadings)
	}
}

func TestDeleteFieldConfirmation_RemovesAndIsIdempotent(t *testing.T) {
	fs := dbtest.New()
	seedConfirmableMisread(fs)
	_, mux := newTestApp(t, fs)
	path := confirmationURL(confirmKey, parser.ScalarPath("eliminations"))
	if rec := put(t, mux, path, shown("74")); rec.Code != http.StatusNoContent {
		t.Fatalf("PUT status = %d", rec.Code)
	}

	for range 2 {
		if rec := del(t, mux, path); rec.Code != http.StatusNoContent {
			t.Errorf("DELETE status = %d, want 204 (idempotent)", rec.Code)
		}
	}
	if len(fs.ConfirmedReadings) != 0 {
		t.Errorf("confirmation survived DELETE: %v", fs.ConfirmedReadings)
	}
}

// publishedFieldPattern is the pattern api/openapi.yaml holds {field} to.
func publishedFieldPattern(t *testing.T) *regexp.Regexp {
	t.Helper()
	raw, err := os.ReadFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Components struct {
			Parameters map[string]struct {
				Schema struct {
					Pattern string `yaml:"pattern"`
				} `yaml:"schema"`
			} `yaml:"parameters"`
		} `yaml:"components"`
	}
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	pattern := spec.Components.Parameters["FieldPath"].Schema.Pattern
	if pattern == "" {
		t.Fatal("api/openapi.yaml publishes no FieldPath parameter pattern")
	}
	return regexp.MustCompile(pattern)
}

// Every path a flag can name — including the hero keys with a space
// ("soldier 76") or a dot ("d.va") in them — is one both the published
// pattern and the server accept. A pattern that refused one would leave that
// hero's flags unconfirmable.
func TestFieldConfirmation_EveryRosterPathIsAccepted(t *testing.T) {
	published := publishedFieldPattern(t)
	fs := dbtest.New()
	seedMatchKeys(fs, confirmKey)
	_, mux := newTestApp(t, fs)

	for _, heroes := range parser.HeroesByRole() {
		for _, name := range heroes {
			hero := parser.Normalize(name)
			for _, field := range []parser.FieldPath{
				parser.HeroPercentPath(hero), parser.SRPath(hero),
			} {
				if !published.MatchString(string(field)) {
					t.Errorf("the published pattern refuses %q", field)
				}
				if rec := put(t, mux, confirmationURL(confirmKey, field), shown("")); rec.Code != http.StatusConflict {
					t.Errorf("PUT %q: status = %d, want 409 (no flag), not a refusal of the path", field, rec.Code)
				}
			}
		}
	}
}
