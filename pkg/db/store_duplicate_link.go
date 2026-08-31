package db

// The "keep separate" verdict on a possible duplicate.
//
// Deciding two matches are different is work — reading two stat lines, or
// two scoreboards, and judging. Before this the judgment was recorded only
// as the absence of an ambiguity, so the next time the user met either card
// nothing said the call had already been made, and a later parse of the
// same folder could ask again.
//
// The link is stored once and read from both ends. "These two look like the
// same match" is a claim about the PAIR, so a card that names its twin and
// a twin that names nothing would be half a fact.

// LinkDuplicateMatches records that matchKey was judged a different match
// from duplicateOf. Idempotent: judging the same pair again replaces the
// row rather than accumulating.
func (s *SQLStore) LinkDuplicateMatches(matchKey, duplicateOf string) error {
	_, err := s.db.Exec(
		`INSERT INTO duplicate_matches (match_key, duplicate_of) VALUES (?,?)
		 ON CONFLICT(match_key) DO UPDATE SET
		   duplicate_of = excluded.duplicate_of,
		   judged_at = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')`,
		matchKey, duplicateOf,
	)
	return err
}

// LoadAllDuplicateLinks returns, per match key, every match it was judged
// separate from — each row read from both ends, so both cards can point at
// each other.
func (s *SQLStore) LoadAllDuplicateLinks() (map[string][]string, error) {
	rows, err := s.db.Query(`SELECT match_key, duplicate_of FROM duplicate_matches ORDER BY match_key`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string][]string{}
	for rows.Next() {
		var key, of string
		if err := rows.Scan(&key, &of); err != nil {
			return nil, err
		}
		out[key] = append(out[key], of)
		out[of] = append(out[of], key)
	}
	return out, rows.Err()
}
