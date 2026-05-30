package app

import (
	"os"
	"os/exec"
	"runtime"
)

// ProbeTesseractBinary walks a per-OS candidate list looking for a
// working Tesseract install, then falls back to PATH lookup if none
// of the well-known locations resolved. Matches the ProbeScreenshotsDir
// shape so the frontend's Detect button can reuse the same chip / tried-
// list rendering.
//
// User report (Windows): the screenshots-folder probe found the OW
// folder, but the Tesseract binary required manual picking. The fix
// widens the search beyond defaultTesseractPath()'s short list to per-
// user installer prefixes (AppData), package managers (Chocolatey,
// scoop, snap, MacPorts), and PATH so the same Detect gesture lands a
// working binary on more machines.
//
// Each candidate is filtered through checkTesseract — file-exists
// alone isn't enough since a forgotten 3.x install would otherwise
// "succeed" while producing wrong OCR output.
func (a *App) ProbeTesseractBinary() ProbeResult {
	home, _ := os.UserHomeDir()
	tried := tesseractProbeCandidates(runtime.GOOS, home)

	for _, c := range tried {
		if _, err := os.Stat(c); err != nil {
			continue
		}
		if checkTesseract(c).Found {
			return ProbeResult{Found: true, Path: c, Tried: tried}
		}
	}
	// PATH lookup as a last resort. Tracked separately in Tried so
	// the "looked in" disclosure differentiates well-known paths
	// from the bare command we asked the OS to resolve.
	if p, err := exec.LookPath(tesseractExecName()); err == nil {
		tried = append(tried, "PATH: "+p)
		if checkTesseract(p).Found {
			return ProbeResult{Found: true, Path: p, Tried: tried}
		}
	}
	return ProbeResult{Found: false, Tried: tried}
}

func tesseractExecName() string {
	if runtime.GOOS == "windows" {
		return "tesseract.exe"
	}
	return "tesseract"
}

// tesseractProbeCandidates returns the ordered candidate list for the
// given GOOS and user-home dir. Kept pure (no os.Stat, no env lookups
// other than the home arg) so tests can exercise the per-OS shape
// without HOME shenanigans.
func tesseractProbeCandidates(goos, home string) []string {
	switch goos {
	case "darwin":
		return []string{
			"/opt/homebrew/bin/tesseract",
			"/usr/local/bin/tesseract",
			"/opt/local/bin/tesseract", // MacPorts
		}
	case "linux":
		return []string{
			"/usr/bin/tesseract",
			"/usr/local/bin/tesseract",
			"/snap/bin/tesseract",
			"/var/lib/flatpak/exports/bin/tesseract",
		}
	case "windows":
		c := []string{
			`C:\Program Files\Tesseract-OCR\tesseract.exe`,
			`C:\Program Files (x86)\Tesseract-OCR\tesseract.exe`,
			`C:\ProgramData\chocolatey\bin\tesseract.exe`,
		}
		if home != "" {
			// String concat with `\` rather than filepath.Join — on a
			// non-Windows host (Linux CI runner exercising the
			// "windows" branch) filepath.Join would use `/` and
			// produce mixed separators that never match a real install.
			c = append(
				c,
				home+`\AppData\Local\Programs\Tesseract-OCR\tesseract.exe`,
				home+`\scoop\shims\tesseract.exe`,
			)
		}
		return c
	}
	return nil
}
