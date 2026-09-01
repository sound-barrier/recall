package rosterwatch_test

import (
	"slices"
	"strings"
	"testing"

	"recall/pkg/parser"
	"recall/pkg/rosterwatch"
)

// The writer's contract: whatever it produces must be a file the app's own
// update path accepts. A bot that writes YAML `ValidateDataYAML` rejects would
// commit a change that silently falls back to embedded data on every boot.

const heroesYAML = `dps:
  - Ashe
  - Mei
tank:
  - "D.va"
`

func TestApplyHero_AppendsUnderTheRoleAndStaysValid(t *testing.T) {
	got, err := rosterwatch.ApplyHero([]byte(heroesYAML), rosterwatch.Hero{Name: "Vantage", Role: "support"}, "Season 5")
	if err != nil {
		t.Fatalf("ApplyHero: %v", err)
	}
	if err := parser.ValidateDataYAML("heroes.yaml", got); err != nil {
		t.Fatalf("the written heroes.yaml is not loadable: %v", err)
	}
	if !strings.Contains(string(got), "Vantage") {
		t.Fatalf("hero not written:\n%s", got)
	}
	// The caveat is not decoration. heroes.yaml's own D.Mon entry carries it,
	// and it is the difference between a name a human vouched for and a name a
	// scraper proposed.
	if !strings.Contains(string(got), "NOT yet checked against a real scoreboard") {
		t.Errorf("the entry landed without its unconfirmed caveat:\n%s", got)
	}
	if !strings.Contains(string(got), "Season 5") {
		t.Errorf("the entry does not say which season it arrived in:\n%s", got)
	}
}

// Appending to a role that ALREADY has entries is the ordinary case, and the
// one that can go wrong invisibly: writing a second "tank:" key instead of
// joining the first leaves a document YAML still parses, with one of the two
// blocks silently dropped.
func TestApplyHero_JoinsAnExistingRoleRatherThanRepeatingTheKey(t *testing.T) {
	got, err := rosterwatch.ApplyHero([]byte(heroesYAML), rosterwatch.Hero{Name: "Vantage", Role: "tank"}, "Season 5")
	if err != nil {
		t.Fatalf("ApplyHero: %v", err)
	}
	if err := parser.ValidateDataYAML("heroes.yaml", got); err != nil {
		t.Fatalf("not loadable: %v", err)
	}
	if n := strings.Count(string(got), "\ntank:"); n != 1 {
		t.Errorf("the file carries %d tank blocks, want 1:\n%s", n, got)
	}
	groups, err := rosterwatch.ParseGroups(got)
	if err != nil {
		t.Fatalf("ParseGroups: %v", err)
	}
	// Both the hero that was there and the one just written must survive. A
	// repeated key parses, and drops one of them.
	if len(groups["tank"]) != 2 {
		t.Errorf("tank = %v, want the existing D.va AND the new Vantage", groups["tank"])
	}
}

// "Soldier: 76" is the name that forces this: written bare, the colon makes
// YAML read the entry as a nested mapping.
func TestApplyHero_QuotesANameYAMLWouldMisread(t *testing.T) {
	got, err := rosterwatch.ApplyHero([]byte(heroesYAML), rosterwatch.Hero{Name: "Soldier: 76", Role: "dps"}, "Season 5")
	if err != nil {
		t.Fatalf("ApplyHero: %v", err)
	}
	if err := parser.ValidateDataYAML("heroes.yaml", got); err != nil {
		t.Fatalf("not loadable: %v", err)
	}
	groups, err := rosterwatch.ParseGroups(got)
	if err != nil {
		t.Fatalf("ParseGroups: %v", err)
	}
	if !slices.Contains(groups["dps"], "Soldier: 76") {
		t.Errorf("dps = %v, want the name whole", groups["dps"])
	}
}

func TestApplyHero_CreatesARoleKeyItDoesNotHave(t *testing.T) {
	got, err := rosterwatch.ApplyHero([]byte("dps:\n  - Ashe\n"), rosterwatch.Hero{Name: "Vantage", Role: "support"}, "Season 5")
	if err != nil {
		t.Fatalf("ApplyHero: %v", err)
	}
	if err := parser.ValidateDataYAML("heroes.yaml", got); err != nil {
		t.Fatalf("not loadable: %v", err)
	}
	if parsedRole(t, got, "Vantage") != "support" {
		t.Errorf("Vantage did not land under support:\n%s", got)
	}
}

// A hero with no role read from upstream must not be written at all — guessing
// the role would file it under a key the app filters on.
func TestApplyHero_RefusesAHeroWithNoRole(t *testing.T) {
	if _, err := rosterwatch.ApplyHero([]byte(heroesYAML), rosterwatch.Hero{Name: "Vantage"}, "Season 5"); err == nil {
		t.Fatal("ApplyHero wrote a hero whose role it never read")
	}
}

func TestApplyMap_AppendsUnderTheGameModeAndStaysValid(t *testing.T) {
	got, err := rosterwatch.ApplyMap([]byte("control:\n  - Ilios\n"), rosterwatch.Map{Name: "Runasapi", GameMode: "push"}, "Season 5")
	if err != nil {
		t.Fatalf("ApplyMap: %v", err)
	}
	if err := parser.ValidateDataYAML("maps.yaml", got); err != nil {
		t.Fatalf("the written maps.yaml is not loadable: %v", err)
	}
	if parsedRole(t, got, "Runasapi") != "push" {
		t.Errorf("Runasapi did not land under push:\n%s", got)
	}
}

func TestApplyMap_RefusesAMapWithNoGameMode(t *testing.T) {
	if _, err := rosterwatch.ApplyMap([]byte("control:\n  - Ilios\n"), rosterwatch.Map{Name: "Runasapi"}, "S5"); err == nil {
		t.Fatal("ApplyMap wrote a map whose game mode it never read")
	}
}

// parsedRole re-reads the written YAML and returns the key `name` sits under —
// asserting on the structure rather than on the bytes, so reformatting is free.
func parsedRole(t *testing.T, doc []byte, name string) string {
	t.Helper()
	groups, err := rosterwatch.ParseGroups(doc)
	if err != nil {
		t.Fatalf("ParseGroups: %v", err)
	}
	for key, names := range groups {
		if slices.Contains(names, name) {
			return key
		}
	}
	return ""
}
