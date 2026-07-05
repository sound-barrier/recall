package gamedata_test

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"recall/pkg/gamedata"
)

// release.yml attaches a roster YAML only when it changed, so the latest release
// can legitimately omit an unchanged heroes.yaml. FetchReleaseRosters must then
// walk back to the most recent release that still carries it — resolving each
// asset independently (heroes and maps can last-change at different releases).
func TestFetchReleaseRosters_WalksBackWhenLatestOmitsAsset(t *testing.T) {
	heroesYAML := []byte("tank:\n  - Reinhardt\n")
	mapsYAML := []byte("control:\n  - Ilios\n")
	sourcesYAML := []byte("sources:\n  - name: OverwatchScreenshot\n")

	mux := http.NewServeMux()
	mux.HandleFunc("/releases", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `[{"tag_name":"v0.25.0"},{"tag_name":"v0.24.0"}]`)
	})
	serve := func(path string, body []byte) {
		mux.HandleFunc(path, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) })
		mux.HandleFunc(path+".sha256", func(w http.ResponseWriter, _ *http.Request) {
			sum := sha256.Sum256(body)
			_, _ = fmt.Fprintf(w, "%s  asset\n", hex.EncodeToString(sum[:]))
		})
	}
	// 0.25.0 carries maps + sources but NOT heroes (unchanged since 0.24.0).
	serve("/dl/v0.25.0/maps.yaml", mapsYAML)
	serve("/dl/v0.25.0/screenshot_sources.yaml", sourcesYAML)
	serve("/dl/v0.24.0/heroes.yaml", heroesYAML)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	origList, origAsset := gamedata.ReleaseListURL, gamedata.ReleaseAssetURL
	t.Cleanup(func() { gamedata.ReleaseListURL = origList; gamedata.ReleaseAssetURL = origAsset })
	gamedata.ReleaseListURL = srv.URL + "/releases"
	gamedata.ReleaseAssetURL = func(version, name string) string {
		return srv.URL + "/dl/v" + version + "/" + name
	}

	heroes, maps, sources := gamedata.FetchReleaseRosters("0.25.0")

	if len(heroes) != 1 || heroes[0] != "Reinhardt" {
		t.Errorf("heroes: want walk-back to 0.24.0 [Reinhardt], got %v", heroes)
	}
	if len(maps) != 1 || maps[0] != "Ilios" {
		t.Errorf("maps: want 0.25.0 [Ilios], got %v", maps)
	}
	if len(sources) != 1 || sources[0] != "OverwatchScreenshot" {
		t.Errorf("sources: want 0.25.0 [OverwatchScreenshot], got %v", sources)
	}
}
