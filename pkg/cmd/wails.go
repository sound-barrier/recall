//go:build !serveronly

package cmd

import (
	"embed"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"

	"recall/pkg/app"
)

// External targets for the Help menu (the browser/kebab equivalents live in
// frontend/src/app-links.ts — keep the two in lockstep).
const (
	docsURL   = "https://sound-barrier.github.io/recall/"
	issuesURL = "https://github.com/sound-barrier/recall/issues"
)

// RunWails launches the full Wails v3 native-window desktop application. The
// App is registered as a v3 service (its exported methods become the frontend
// bindings + its ServiceStartup runs the cold-boot init); the screenshots
// handler rides the AssetServer middleware chain; the window auto-sizes to a
// share of the display on first paint.
func RunWails(a *app.App, assets embed.FS) {
	// The desktop's ServiceStartup hands Startup a real lifecycle context, so the
	// background engine probe's "tesseract-status" emit is safe here.
	app.EnableTesseractProbeOnStartup()

	// Declared up front so the single-instance callback can focus it — the
	// window itself is created after application.New below.
	var win *application.WebviewWindow

	// Native desktop notifications (parse-complete). Registered as a v3 service
	// for lifecycle management; the parse-complete sender is wired below.
	notifier := notifications.New()

	wailsApp := application.New(application.Options{
		Name:        "Recall",
		Description: "Overwatch screenshot telemetry — local match history + trends",
		Services: []application.Service{
			application.NewService(a),
			application.NewService(notifier),
		},
		Assets: application.AssetOptions{
			// Embedded frontend/dist, with the /_screenshot/ handler short-
			// circuited ahead of it (same contract as the v2 AssetServer).
			Handler:    application.AssetFileServerFS(assets),
			Middleware: screenshotsMiddleware(a.ScreenshotHandler()),
		},
		Mac: application.MacOptions{
			// false so closing the window keeps Recall alive in the menu-bar tray
			// (the background-watcher) instead of quitting; the tray's "Quit
			// Recall" + Cmd+Q are the explicit exits.
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		// A second `recall` launch focuses the running window instead of spawning
		// a rival process that would double-watch the folder and contend on the
		// SQLite file. UniqueID matches build/config.yml's productIdentifier.
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.sound-barrier.recall",
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				if win != nil {
					win.Restore()
					win.Focus()
				}
			},
		},
	})

	// Native menu, per-OS (see desktopMenu): macOS gets the full Chrome/Firefox-
	// style menu bar wired to the in-app dialogs; Windows/Linux use the ⋮ kebab.
	if m := desktopMenu(runtime.GOOS); m != nil {
		wailsApp.Menu.Set(m)
	}

	win = wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Recall",
		Width:            minWindowW,
		Height:           minWindowH,
		BackgroundColour: application.NewRGB(27, 38, 54),
		URL:              "/",
	})
	// Creation size is a safe minimum; grow it to a share of the actual display
	// (the fixed 1024×768 felt cramped on 1440p+ monitors).
	sizeWindowToScreen(win)
	setupSystemTray(wailsApp, win, a)

	// Wire native parse-complete notifications — but only when notifications can
	// initialize without aborting (see notificationsSupported). Authorization is
	// requested once on a goroutine (the macOS prompt needs the run loop that Run
	// starts below); SendNotification degrades gracefully until/unless granted.
	if notificationsSupported() {
		go func() { _, _ = notifier.RequestNotificationAuthorization() }()
		app.SetParseCompleteNotifier(func(matchCount int) {
			_ = notifier.SendNotification(notifications.NotificationOptions{
				ID:    "recall-parse-complete",
				Title: "Recall",
				Body:  parseCompleteBody(matchCount),
			})
		})
	}

	if err := wailsApp.Run(); err != nil {
		println("Error:", err.Error())
	}
}

// parseCompleteBody renders the parse-complete notification body, pluralising
// "match" on the distinct-match count.
func parseCompleteBody(matchCount int) string {
	if matchCount == 1 {
		return "Parsed 1 new match"
	}
	return fmt.Sprintf("Parsed %d new matches", matchCount)
}

// notificationsSupported reports whether native notifications can be wired
// without aborting the process. macOS's UNUserNotificationCenter throws an
// uncatchable Obj-C exception when the app has no bundle identifier — i.e. the
// raw binary run outside a .app (e.g. `./bin/Recall` straight from a build).
// Inside a .app bundle (every normal launch) it's fine; other OSes don't care.
func notificationsSupported() bool {
	if runtime.GOOS != "darwin" {
		return true
	}
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	return strings.Contains(exe, ".app/Contents/MacOS/")
}

// desktopMenu returns the native macOS menu bar (Chrome/Firefox style); nil off
// macOS, where the in-app ⋮ kebab handles it. Custom items emit `menu:*` events
// that the frontend's useNativeMenu opens the matching dialog for; Edit + Window
// stay native roles. Callbacks reach the running app via application.Get() so
// the builder needs no app handle (and stays nil-safe under test).
func desktopMenu(goos string) *application.Menu {
	if goos != "darwin" {
		return nil
	}

	emit := func(name string, data ...any) func(*application.Context) {
		return func(*application.Context) {
			if a := application.Get(); a != nil {
				a.Event.Emit(name, data...)
			}
		}
	}
	openURL := func(url string) func(*application.Context) {
		return func(*application.Context) {
			if a := application.Get(); a != nil {
				_ = a.Browser.OpenURL(url)
			}
		}
	}

	menu := application.NewMenu()

	recall := menu.AddSubmenu("Recall")
	recall.Add("About Recall").OnClick(emit("menu:about"))
	recall.AddSeparator()
	recall.Add("Settings…").SetAccelerator("CmdOrCtrl+,").OnClick(emit("menu:settings"))
	recall.AddSeparator()
	recall.Add("Hide Recall").SetAccelerator("CmdOrCtrl+H").OnClick(func(*application.Context) {
		if a := application.Get(); a != nil {
			a.Hide()
		}
	})
	recall.Add("Quit Recall").SetAccelerator("CmdOrCtrl+Q").OnClick(func(*application.Context) {
		if a := application.Get(); a != nil {
			a.Quit()
		}
	})

	menu.AddRole(application.EditMenu)

	view := menu.AddSubmenu("View")
	view.Add("Settings").SetAccelerator("CmdOrCtrl+1").OnClick(emit("menu:view", "settings"))
	view.Add("Parse").SetAccelerator("CmdOrCtrl+2").OnClick(emit("menu:view", "ingest"))
	view.Add("Matches").SetAccelerator("CmdOrCtrl+3").OnClick(emit("menu:view", "matches"))
	view.Add("Unknown").SetAccelerator("CmdOrCtrl+4").OnClick(emit("menu:view", "unknown"))

	menu.AddRole(application.WindowMenu)

	help := menu.AddSubmenu("Help")
	help.Add("Keyboard Shortcuts").OnClick(emit("menu:shortcuts"))
	help.Add("Recall Documentation").OnClick(openURL(docsURL))
	help.Add("Report an Issue").OnClick(openURL(issuesURL))
	help.AddSeparator()
	help.Add("About Recall").OnClick(emit("menu:about"))

	return menu
}

// screenshotsMiddleware short-circuits `/_screenshot/...` requests to the
// provided handler before they hit the AssetServer's downstream pipeline (Vite
// proxy in dev, embedded assets in production). Wired as AssetOptions.Middleware
// so it runs ahead of Wails's internal asset handling in both dev and prod.
//
// Extracted for testability — see middleware_test.go.
func screenshotsMiddleware(screenshots http.Handler) application.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/_screenshot/") {
				screenshots.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
