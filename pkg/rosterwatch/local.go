package rosterwatch

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// VersionURL is the app's own published data channel — the same document
// pkg/gamedata reads to decide whether an installed copy has an update.
var VersionURL = "https://sound-barrier.github.io/recall/data/version.json"

// publishedVersion is version.json's shape, stamped by pages.yml from the last
// commit that touched a roster path.
type publishedVersion struct {
	CommitSHA   string `json:"commit_sha"`
	CommittedAt string `json:"committed_at"`
}

// ChannelFinding reports when the published channel is behind the repo.
//
// A merged roster change reaches installed copies only if pages.yml ran and
// re-stamped version.json. Nothing else in the repo notices when it did not:
// the app would keep answering "you're up to date" against data that is not.
//
// localCommit is the SHA of the last commit touching a roster file, which the
// caller reads from git. An empty one is an error rather than a pass — not
// knowing is not the same as being fine.
func ChannelFinding(client *http.Client, localCommit string) (*Finding, error) {
	if localCommit == "" {
		return nil, errors.New("rosterwatch: no local roster commit to compare the channel against")
	}
	body, err := getBytes(client, VersionURL)
	if err != nil {
		return nil, err
	}
	var pv publishedVersion
	if err := json.Unmarshal(body, &pv); err != nil {
		return nil, fmt.Errorf("%w: %s is not a version document: %w", ErrSourceUnreadable, VersionURL, err)
	}
	if pv.CommitSHA == "" {
		return nil, fmt.Errorf("%w: %s carries no commit_sha", ErrSourceUnreadable, VersionURL)
	}
	if pv.CommitSHA == localCommit {
		return nil, nil
	}
	return &Finding{
		Kind: KindChannelStale, Name: short(pv.CommitSHA),
		Detail: fmt.Sprintf(
			"the published data channel is at %s but the newest roster commit here is %s — installed copies are on stale data, check that pages.yml ran",
			short(pv.CommitSHA), short(localCommit)),
	}, nil
}

func short(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}
