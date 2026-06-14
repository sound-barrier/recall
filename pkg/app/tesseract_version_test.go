package app_test

import (
	"testing"

	"recall/pkg/app"
)

func TestParseTesseractVersion_5xSupported(t *testing.T) {
	tests := []struct {
		name           string
		stdout, stderr string
		wantVersion    string
		wantSupported  bool
	}{
		{
			name:          "5.x banner on stderr (Linux apt build)",
			stderr:        "tesseract 5.5.0\n leptonica-1.83.1\n",
			wantVersion:   "5.5.0",
			wantSupported: true,
		},
		{
			name:          "5.x banner on stdout (Homebrew build)",
			stdout:        "tesseract 5.3.4\nleptonica-1.84.1\n",
			wantVersion:   "5.3.4",
			wantSupported: true,
		},
		{
			name:          "5.x banner with leading 'v'",
			stdout:        "tesseract v5.5.0\n",
			wantVersion:   "5.5.0",
			wantSupported: true,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			version, supported, msg := app.ParseTesseractVersion(tc.stdout, tc.stderr)
			if msg != "" {
				t.Fatalf("unexpected diagnostic: %q", msg)
			}
			if version != tc.wantVersion {
				t.Errorf("version got %q want %q", version, tc.wantVersion)
			}
			if supported != tc.wantSupported {
				t.Errorf("supported got %v want %v", supported, tc.wantSupported)
			}
		})
	}
}

func TestParseTesseractVersion_OlderMajorUnsupported(t *testing.T) {
	tests := []struct {
		name           string
		stdout, stderr string
		wantVersion    string
	}{
		{"4.x", "tesseract 4.1.1\n", "", "4.1.1"},
		{"3.x", "", "tesseract 3.05.02\n", "3.05.02"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			version, supported, msg := app.ParseTesseractVersion(tc.stdout, tc.stderr)
			if msg != "" {
				t.Fatalf("unexpected diagnostic: %q", msg)
			}
			if supported {
				t.Errorf("major-3/4 version must report supported=false")
			}
			if version != tc.wantVersion {
				t.Errorf("version got %q want %q", version, tc.wantVersion)
			}
		})
	}
}

func TestParseTesseractVersion_NotTesseractBinary(t *testing.T) {
	tests := []struct {
		name           string
		stdout, stderr string
	}{
		{"empty output", "", ""},
		{"random text", "this is not tesseract\n", ""},
		{"vendor noise", "leptonica-1.83.1\n", "OpenCV 4.5\n"},
		{"close-but-no-cigar", "tesserect 5.5.0\n", ""}, // typo: "tesserect"
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			version, supported, msg := app.ParseTesseractVersion(tc.stdout, tc.stderr)
			if msg == "" {
				t.Errorf("expected a diagnostic message for non-Tesseract output")
			}
			if version != "" {
				t.Errorf("version must be empty when binary isn't Tesseract, got %q", version)
			}
			if supported {
				t.Errorf("supported must be false when binary isn't Tesseract")
			}
		})
	}
}
