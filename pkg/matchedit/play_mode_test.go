package matchedit_test

import (
	"errors"
	"testing"

	"recall/pkg/matchedit"
)

func TestSetPlayMode_PersistsValidValue(t *testing.T) {
	fake := seeded("m1", "m2")
	mustNoErr(t, matchedit.SetPlayMode(fake, "m1", "competitive"))
	mustNoErr(t, matchedit.SetPlayMode(fake, "m2", "quickplay"))
	got, _ := fake.LoadMatchPlayModes()
	if got["m1"].PlayMode != "competitive" || got["m2"].PlayMode != "quickplay" {
		t.Errorf("play_modes map wrong: %+v", got)
	}
}

func TestSetPlayMode_RejectsInvalidValue(t *testing.T) {
	fake := seeded("m1")
	for _, c := range []string{"", "unranked", "QUICKPLAY", "ranked", "comp"} {
		if err := matchedit.SetPlayMode(fake, "m1", c); !errors.Is(err, matchedit.ErrInvalidPlayMode) {
			t.Errorf("SetPlayMode(%q): err = %v, want ErrInvalidPlayMode", c, err)
		}
	}
}

func TestBulkSetPlayMode_WritesEveryKey(t *testing.T) {
	fake := seeded("m1", "m2", "m3")
	mustNoErr(t, matchedit.BulkSetPlayMode(fake, []string{"m1", "m2", "m3"}, "competitive"))
	got, _ := fake.LoadMatchPlayModes()
	for _, k := range []string{"m1", "m2", "m3"} {
		if got[k].PlayMode != "competitive" {
			t.Errorf("after bulk set, %s = %q, want competitive", k, got[k].PlayMode)
		}
	}
}

func TestBulkSetPlayMode_EmptyValueClearsRows(t *testing.T) {
	fake := seeded("m1", "m2")
	mustNoErr(t, matchedit.SetPlayMode(fake, "m1", "competitive"))
	mustNoErr(t, matchedit.SetPlayMode(fake, "m2", "quickplay"))
	mustNoErr(t, matchedit.BulkSetPlayMode(fake, []string{"m1"}, ""))
	got, _ := fake.LoadMatchPlayModes()
	if _, ok := got["m1"]; ok {
		t.Errorf("m1 should have been cleared, got %+v", got["m1"])
	}
	if got["m2"].PlayMode != "quickplay" {
		t.Errorf("m2 not in clear list, should still be quickplay; got %q", got["m2"].PlayMode)
	}
}

func TestBulkSetPlayMode_RejectsInvalidValue(t *testing.T) {
	err := matchedit.BulkSetPlayMode(seeded("m1"), []string{"m1"}, "unranked")
	if !errors.Is(err, matchedit.ErrInvalidPlayMode) {
		t.Errorf("got %v, want ErrInvalidPlayMode", err)
	}
}

func TestSetPlayMode_OverwritesExisting(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.SetPlayMode(fake, "m1", "competitive"))
	mustNoErr(t, matchedit.SetPlayMode(fake, "m1", "quickplay"))
	got, _ := fake.LoadMatchPlayModes()
	if got["m1"].PlayMode != "quickplay" {
		t.Errorf("after overwrite, m1 = %q, want quickplay", got["m1"].PlayMode)
	}
}

func TestClearPlayMode_IsIdempotent(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.ClearPlayMode(fake, "never-set"))
	mustNoErr(t, matchedit.SetPlayMode(fake, "m1", "competitive"))
	mustNoErr(t, matchedit.ClearPlayMode(fake, "m1"))
	got, _ := fake.LoadMatchPlayModes()
	if _, ok := got["m1"]; ok {
		t.Errorf("m1 should be cleared, got %+v", got["m1"])
	}
	mustNoErr(t, matchedit.ClearPlayMode(fake, "m1"))
}

func TestPlayModeWrites_RequireAMatchKey(t *testing.T) {
	fake := seeded()
	if err := matchedit.SetPlayMode(fake, "", "competitive"); err == nil {
		t.Error("expected error for empty match_key")
	}
	if err := matchedit.ClearPlayMode(fake, ""); err == nil {
		t.Error("expected error for empty match_key on clear")
	}
}

func TestIsValidPlayMode(t *testing.T) {
	for _, ok := range []string{"quickplay", "competitive"} {
		if !matchedit.IsValidPlayMode(ok) {
			t.Errorf("IsValidPlayMode(%q) = false, want true", ok)
		}
	}
	// The empty string is "follow the parser", which the manual form treats
	// as omission — it is NOT a stored value.
	for _, bad := range []string{"", "ranked", "unranked", "QUICKPLAY"} {
		if matchedit.IsValidPlayMode(bad) {
			t.Errorf("IsValidPlayMode(%q) = true, want false", bad)
		}
	}
}
