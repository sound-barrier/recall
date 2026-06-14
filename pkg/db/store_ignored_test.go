package db_test

import "testing"

func TestSQLStore_LoadIgnoredFilenames_ReturnsSet(t *testing.T) {
	s := openMemory(t)

	got, err := s.LoadIgnoredFilenames()
	if err != nil {
		t.Fatalf("empty load: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("want empty set, got %v", got)
	}

	for _, f := range []string{"a.png", "b.png"} {
		if err := s.AddIgnoredScreenshot(f); err != nil {
			t.Fatalf("add %s: %v", f, err)
		}
	}
	got, err = s.LoadIgnoredFilenames()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if !got["a.png"] || !got["b.png"] || len(got) != 2 {
		t.Errorf("want {a.png, b.png}, got %v", got)
	}
}

func TestSQLStore_RemoveIgnoredScreenshot(t *testing.T) {
	s := openMemory(t)
	for _, f := range []string{"x.png", "y.png"} {
		if err := s.AddIgnoredScreenshot(f); err != nil {
			t.Fatalf("add %s: %v", f, err)
		}
	}
	if err := s.RemoveIgnoredScreenshot("x.png"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	got, _ := s.LoadIgnoredFilenames()
	if got["x.png"] {
		t.Error("x.png should be removed")
	}
	if !got["y.png"] {
		t.Error("y.png should survive the remove of x.png")
	}

	// Idempotent: removing an absent filename is a no-op, not an error.
	if err := s.RemoveIgnoredScreenshot("never.png"); err != nil {
		t.Errorf("remove of absent filename should be a no-op, got %v", err)
	}
}
