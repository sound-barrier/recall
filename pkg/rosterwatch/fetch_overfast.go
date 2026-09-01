package rosterwatch

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// The map list, from the community API.
//
// Not first-party, and that is a real cost — it is a third party standing
// between this repo and the truth. It is the trade for a FULL LIST: Blizzard's
// own /maps/ page renders client-side, and their patch notes announce a new map
// as an event, which cannot tell you about one added during a week the watch
// was broken. A list is self-healing; an event stream is not.

// overFastMap is the response shape, narrowed to what a roster edit needs.
type overFastMap struct {
	Name      string   `json:"name"`
	GameModes []string `json:"gamemodes"`
}

// FetchMaps reads the upstream map list.
func FetchMaps(client *http.Client) ([]Map, error) {
	body, err := getBytes(client, MapsURL)
	if err != nil {
		return nil, err
	}
	var raw []overFastMap
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("%w: %s did not return a map list: %w", ErrSourceUnreadable, MapsURL, err)
	}
	out := make([]Map, 0, len(raw))
	for _, m := range raw {
		if m.Name == "" {
			continue
		}
		// A map can carry several modes; the first is the one maps.yaml would
		// file it under, and a wrong guess here is a line the maintainer moves,
		// not a name they have to re-derive.
		mode := ""
		if len(m.GameModes) > 0 {
			mode = m.GameModes[0]
		}
		out = append(out, Map{Name: m.Name, GameMode: mode})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%w: no maps at %s", ErrSourceUnreadable, MapsURL)
	}
	return out, nil
}
