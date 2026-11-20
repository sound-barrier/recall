# Auto-capture spike — Windows Graphics Capture instead of a hotkey

An outside review of the README suggested that Recall stop asking the player
to press a screenshot hotkey after every match and instead **capture the
post-match screens itself** through Windows Graphics Capture (WGC), detect which
screen is up from its pixels, and feed the frames straight to the parser. That
would remove the capture tool, its filename grammar, and the minutes-apart
guesswork the correlator does today.

`FEATURES.md` already lists this idea under **Denied / Won't Do** ("Live OCR
while OW is running"), on anti-cheat optics. This spike asks whether a closer
look at the API changes that answer. It is a **paper spike**: nothing was built
or run against Overwatch. Every API claim below cites Microsoft's or OBS's own
pages, every Recall claim names the file it comes from, and the claims that
could not be verified are listed together at the end.

## Verdict

**The Denied stance stands. Do not build auto-capture unless the maintainer
reopens the entry.** The technical case is better than the Denied entry
implies. WGC is a compositor-level API that injects nothing into the game
process (OBS's *window* capture uses it; OBS's *game* capture is the one that
injects a hook). A pure-Go, CGo-free implementation is feasible on top of
`go-ole`, which is already in the module graph. But the reasons to say no are
not technical:

1. **The EULA does not separate live capture from hotkey capture, so nothing in
   the text makes live capture safe.** Blizzard's EULA forbids "any unauthorized
   process or software that intercepts, collects, reads, or 'mines' information
   generated or stored by the Platform". A process that watches the game window
   every second while a ranked match is live is the most literal reading of
   that clause. Recall's current boundary keeps the player the actor: they press
   a key, and Recall reads files on disk afterward. That boundary is the one
   that is easy to explain.
2. **Recall cannot see Blizzard's anti-cheat, so it cannot test whether the
   capture trips it.** A false positive would cost a user their account. Recall
   has no Windows test machine running a live Overwatch client, so it could not
   find out before users did.
3. **The payoff is narrow.** Live capture would retire most of `pkg/correlate`
   only for the frames it took itself. The folder watcher, the filename
   grammars and every correlation pass stay for the manual workflow (see
   [What auto-capture would retire](#what-auto-capture-would-retire-in-pkgcorrelate)).
   The total code grows. It does not shrink.

## The capture API — what WGC is and isn't

| Mechanism | How it gets pixels | Touches the game process? | Who uses it |
|---|---|---|---|
| **Windows.Graphics.Capture** | Desktop compositor hands frames of one window or display to a `Direct3D11CaptureFramePool` | **No.** It is an OS API over the composed surface | OBS *Window Capture* (WGC method), Discord screen share |
| **OBS Game Capture** | Injects a hook library into the game (`inject_hook` → `inject_library`, or a helper process in anti-cheat-compatibility mode) | **Yes.** It loads code into the game | OBS *Game Capture* |
| **DXGI Desktop Duplication** | Whole-output (monitor) frames via `IDXGIOutputDuplication::AcquireNextFrame` | No | Remote-desktop and screen-recording tools |
| **`PrintWindow`** | Asks the *target app* to paint itself into a DC (`WM_PRINT`) | Sends it a message | GDI screenshot utilities |

What the WGC docs establish:

- The namespace "provides APIs to acquire frames from a display or application
  window". Frames arrive through `Direct3D11CaptureFramePool.FrameArrived` or a
  `TryGetNextFrame` pull, as D3D11 surfaces in `B8G8R8A8` (Microsoft Learn,
  *Screen capture*).
- **Capturing a specific window without the user picker** goes through the
  Win32 interop `IGraphicsCaptureItemInterop::CreateForWindow(HWND, REFIID,
  void**)`. Its minimum supported client is **Windows 10 version 1903 (build
  18362)** (Microsoft Learn, *CreateForWindow*).
- **A yellow capture border is drawn by default.** `GraphicsCaptureSession.
  IsBorderRequired` (build 20348+) can turn it off only after
  `GraphicsCaptureAccess.RequestAccessAsync(Borderless)` gets the user's
  consent, which in turn requires the `graphicsCaptureWithoutBorder` capability
  in the app's *package manifest*. Recall ships as an unpackaged NSIS install
  (`build/windows/nsis/project.nsi`) with no package manifest. OBS, also
  unpackaged, calls `session.IsBorderRequired(false)` in
  `libobs-winrt/winrt-capture.cpp`. Whether Windows honors that for an
  unpackaged process without the consent prompt is **not verified here**. Plan
  for the border to show.
- **HDR**: on HDR displays the content format may not be `B8G8R8A8`. Microsoft
  recommends an `R16G16B16A16_FLOAT` pipeline to avoid washed-out frames. The
  parser's color thresholds (for example `isBlueTablePixel` /
  `isRedTablePixel` in `pkg/parser/queue.go`) were tuned on SDR captures, so an
  HDR capture would need tone mapping before it reaches them.

OBS's source confirms the window-capture vs game-capture split.
`plugins/win-capture/window-capture.c` offers `METHOD_BITBLT` and `METHOD_WGC`,
and calls `winrt_capture_init_window` from `libobs-winrt` for the latter.
`plugins/win-capture/game-capture.c` reaches the game through `inject_hook()`,
either directly (`hook_direct` → `inject_library`) or through
`inject-helper64.exe` when the anti-cheat-compatibility hook is on. OBS's own
knowledge base says changing the hook's signing certificate "may require updates
to anti-cheat solutions that specifically exempt the current certificate". In
other words, the injecting path is the one anti-cheat vendors allowlist. WGC
does not need an allowlist entry, because it never enters the process.

Discord's support article on application capture (fetched through a search
summary, because a direct fetch returned HTTP 403) describes WGC as a Windows 10+
capture method that Discord makes the default on Windows 11. It also says WGC
**does not work for full-screen-exclusive games**. Overwatch offers a
full-screen mode, so a share of players would get black or stale frames until
they switched to borderless windowed. That cost lands on the user, the opposite
of "it just works".

Whether **Xbox Game Bar** uses WGC internally is **not verified**. Its public
documentation describes behavior, not mechanism.

## Terms and anti-cheat

From the Blizzard End User License Agreement (last revised March 21, 2024),
section 1.C:

- **1.C.ii (Cheating)** prohibits "any code and/or software, not expressly
  authorized by Blizzard, that can be used in connection with the Platform
  and/or any component or feature thereof which changes and/or facilitates the
  gameplay or other functionality".
- **1.C.vi (Data Mining)** prohibits "any unauthorized process or software that
  intercepts, collects, reads, or 'mines' information generated or stored by the
  Platform; provided, however, that Blizzard may, at its sole and absolute
  discretion, allow the use of certain third-party user interfaces."
- The EULA's consent-to-monitor section says the Platform "may monitor your
  computer … memory" for unauthorized programs and "may communicate information
  back to Blizzard".

How this reads for Recall (an engineering reading, not legal advice):

- Neither clause names a mechanism, so "WGC does not inject" is a technical
  argument, not a contractual one. A capture loop on the game window "reads
  information generated by the Platform" as plainly as any memory reader would.
- The hotkey workflow is not cleanly outside 1.C.vi either. OCR of a saved
  screenshot also reads information the game generated. What separates the two
  is **who acts and when**: the player presses a key after the match, and Recall
  touches files only, never the running game. That boundary is the one
  `docs/faq.md` already tells users ("Recall doesn't watch the game live").
- "Facilitates the gameplay" is the clause a live loop gets closest to: any
  feature that surfaced data *during* a match (even a between-rounds rank
  readout) would sit squarely inside it. Auto-capture limited to post-match
  screens is narrower, but the capture process would still be running during
  the match in order to notice it ending.
- No public Blizzard statement on screen-capture overlays for Overwatch was
  found, and the anti-cheat's behavior toward WGC sessions on the game window
  is unknown. That is the risk the Denied entry names.

## A pure-Go implementation path

The project constraint is no CGo (`pkg/CLAUDE.md`: "Do not introduce CGo
dependencies; the pure-Go build constraint is load-bearing for the release
pipeline"). The Windows build is `CGO_ENABLED=0` (`Taskfile.yml`). WGC is
reachable within that constraint:

1. `RoInitialize` + `RoGetActivationFactory("Windows.Graphics.Capture.
   GraphicsCaptureItem", IID_IGraphicsCaptureItemInterop)`. **`go-ole` v1.3.0
   already wraps both** (`winrt.go`: `RoInitialize`, `RoActivateInstance`,
   `RoGetActivationFactory`, `NewHString`) with no `import "C"`. `golang.org/x/sys/windows`
   has no WinRT/combase wrappers. Today it is used only for
   `windows/registry` in `pkg/probe/probe_windows.go`.
2. `IGraphicsCaptureItemInterop::CreateForWindow(hwnd)` on the Overwatch window
   (found by process name or window class).
3. `D3D11CreateDevice` (`d3d11.dll` via `syscall.NewLazyDLL`) →
   `CreateDirect3D11DeviceFromDXGIDevice` → `Direct3D11CaptureFramePool.
   CreateFreeThreaded` → `CreateCaptureSession` → `StartCapture`.
4. Per frame: `IDirect3DDxgiInterfaceAccess::GetInterface` → `ID3D11Texture2D`
   → `CopyResource` into a CPU-readable staging texture → `Map` → copy rows
   into an `image.RGBA` → `Unmap`.
5. Hand-written vtable structs plus `syscall.SyscallN` for every interface
   above that `go-ole` does not model (most of them). That boilerplate is the
   bulk of the code.

**Size estimate: ~1–1.5k lines of Go**, plus tests. This is an estimate from the
interface count above, not a count of a working prototype; none was built. It
would live in a new Windows-only leaf package (for example `pkg/capture`,
`//go:build windows`), with a no-op twin for the macOS dev build in the
`probe_windows.go` / `probe_other.go` pattern.

Dependency notes:

- `golang.org/x/sys v0.50.0` is already a **direct** requirement in `go.mod`.
- `github.com/go-ole/go-ole v1.3.0` is **indirect** today, pulled in by
  Wails' common-file-dialog (`go mod why -m github.com/go-ole/go-ole`:
  `recall/pkg/app` → `wails/v3/pkg/application` →
  `wails/v3/internal/go-common-file-dialog/cfd` → `go-ole`). Promoting it to
  direct adds no new module, but it is still a dependency decision under
  CLAUDE.md's approval rule.
- Testing is the weak point. There is no Windows-runtime test tier, CI cannot
  run Overwatch, and black-box tests could only target a synthetic window.

## Simpler alternatives

- **DXGI Desktop Duplication** (Windows 8+) returns the whole *output*, not one
  window, always as `B8G8R8A8`. It needs no yellow border and no WinRT. It does
  need the same D3D11 vtable plumbing, plus cropping to the game's monitor
  and window rectangle. It also captures whatever is drawn over the game
  (notifications, overlays, an alt-tabbed window). It is smaller than WGC but
  sees more than the game, which is a worse privacy posture for a no-upload
  app.
- **`PrintWindow`** is documented as having the target application render
  itself into a DC via `WM_PRINT`. A D3D game's swapchain is not drawn through
  GDI, so the widely reported result is a black frame. Microsoft's page does
  not say this directly, so it is **not verified here**, but nothing on the page
  suggests it would capture D3D content. Not viable.
- **Write captured frames into the watched folder.** Whatever API does the
  capturing, the lowest-risk integration is to save PNG files into the screenshots
  folder under a new grammar entry in `pkg/parser/screenshot_sources.yaml`. The
  existing watcher (`pkg/app/watcher.go`, 60 s debounce) and correlator then
  take it from there unchanged. This is also the integration that retires
  nothing.
- **Video clip support** (`FEATURES.md` → Triaging → Ingest & OCR) already
  proposes the same "classify every 0.5 s, keep the matching frame" loop over a
  *recording* the player made. It gets the frame-selection benefit after the
  fact, with no process near the live game. If frame selection is the goal,
  this is the version that fits the current boundary.

## Detecting the right screen from pixels

A live loop cannot OCR every frame. The OCR engine spike measured Tesseract at
~1.85 s per image on CPU (`spike/OCR-ENGINE-SPIKE.md`). The parser's own
classifier cannot help either: `parser.Classify` (`pkg/parser/classify.go`)
sniffs which *fields the OCR populated*, so it runs after OCR, not before.
Auto-capture would need a new pre-OCR classifier on a downscaled frame at about
1–2 Hz:

- **TEAMS**: the highlighted friendly row (`findHighlightedRowY`,
  `pkg/parser/parse_teams.go`) and the blue/red team-table colors
  (`isBlueTablePixel` / `isRedTablePixel`, `pkg/parser/queue.go`). Pixel-only
  precedents already exist in the parser.
- **SUMMARY / PERSONAL / RANK**: stable layout anchors (the result banner, the
  tab strip, the rank panel). These would need fixed-region signatures cut from
  corpus screenshots, the same reference-from-pixels discipline the template
  work in this campaign adopts.
- **Debounce per screen**: capture each screen once per appearance, not once per
  frame. Otherwise the duplicate problem moves from the user's folder into
  Recall's own output.

## What auto-capture would retire in `pkg/correlate`

For frames Recall captured itself, one capture session sees the in-game TEAMS
shot (when the player opens Tab) and then the post-match screens in order, so it
could stamp them with one session id. That makes these redundant **for those
frames only**:

- `ParseFilenameTimestamp` + `timestampFromCaptures` and the four grammars in
  `pkg/parser/screenshot_sources.yaml`. The capture loop knows the instant
  directly.
- `MatchByEAD` and its 5/30-minute windows (`correlation_ead.go`). The EAD
  bridge exists because TEAMS and SUMMARY captures can be minutes apart with
  only E/A/D in common.
- `MatchByTimestampWindow`, `closestPerKey`, `MergeWindow`, `TieToleranceWindow`
  and the signature check in `RowsConflict` (`correlation.go`), along with the
  `ambiguous-<filename>` keys they mint for the Unknown tab.
- Most of the duplicate sweeps (`DuplicateScan`, the stat-line producer in
  `correlation_duplicate.go`, the re-capture identity in
  `correlation_recapture.go`), since a debounced loop does not double-capture.

None of it can be deleted while the folder workflow exists, and the folder
workflow cannot go. It is how players with Nvidia, Steam or the in-game
Print Screen key use Recall today, and how a coach's re-import works. The
correlator would gain a third input path, not lose its existing ones.

## Recommendation

1. **Keep "Live OCR while OW is running" in Denied.** Nothing found here
   weakens the anti-cheat and EULA rationale. The one correction is that WGC is
   not a "capture hook", so if the entry is ever reworded it should say
   *any* live capture of the game window, hooked or not, because the EULA clause
   is mechanism-agnostic.
2. **Spend the effort where this campaign already is**, on making each
   *hotkey* screenshot read correctly and flag its own misreads (field
   evidence, template cross-checks, plausibility checks). That attacks the
   same "my numbers are wrong" pain without going near the running game.
3. **If frame selection is ever wanted**, take the Triaging *Video clip
   support* route over recordings the player made. It reuses the pixel
   classifier sketched above with no live process.

### What would have to be true to reopen

- **Blizzard says so in writing**: either Overwatch-specific guidance that
  passive, non-injecting window capture by a stats tool is permitted, or Recall
  receives the "expressly authorized" status that 1.C.ii and 1.C.vi carve out.
- **Evidence that the anti-cheat leaves WGC alone on the game window**,
  meaning a public statement or a well-established tool that has used WGC on
  Overwatch's window for a long time with no enforcement reports. Absence of
  complaints alone is not enough.
- **The maintainer explicitly reopens the Denied entry** and accepts the costs:
  the yellow border (or verified suppression for an unpackaged app), the
  full-screen-exclusive gap, HDR tone mapping, a Windows-only package with no
  automated runtime test tier, and promoting `go-ole` to a direct dependency.
- **The capture is limited to post-match screens and surfaces nothing during a
  match**, so no feature can be read as facilitating gameplay.

## Claims not verified

- That Windows honors `IsBorderRequired(false)` for an **unpackaged** desktop
  app without the `graphicsCaptureWithoutBorder` manifest capability. OBS's
  source sets it, but the docs require consent plus a package capability.
- That WGC fails on **Overwatch** in full-screen mode specifically. The claim
  comes from Discord's article (read through a search summary after a 403) about
  full-screen-exclusive games in general.
- How Blizzard's anti-cheat treats a WGC session on the Overwatch window. No
  public source was found.
- Whether Xbox Game Bar captures through WGC.
- That `PrintWindow` returns black frames for D3D content. This is widely
  reported, but Microsoft's reference page does not state it.
- The ~1–1.5k LOC estimate. It is reasoned from the interface count, not
  measured from a prototype.

## Sources

- Microsoft Learn — Screen capture (Windows.Graphics.Capture):
  <https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture>
- Microsoft Learn — `IGraphicsCaptureItemInterop::CreateForWindow`:
  <https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow>
- Microsoft Learn — `GraphicsCaptureSession.IsBorderRequired`:
  <https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.isborderrequired>
- Microsoft Learn — Desktop Duplication API:
  <https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api>
- Microsoft Learn — `PrintWindow`:
  <https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow>
- Microsoft Learn — `RoGetActivationFactory`:
  <https://learn.microsoft.com/en-us/windows/win32/api/roapi/nf-roapi-rogetactivationfactory>
- OBS Studio source — `libobs-winrt/winrt-capture.cpp`,
  `plugins/win-capture/window-capture.c`, `plugins/win-capture/game-capture.c`:
  <https://github.com/obsproject/obs-studio>
- OBS knowledge base — Capture Hook Certificate Update:
  <https://obsproject.com/kb/capture-hook-certificate-update>
- OBS knowledge base — Window Capture Sources:
  <https://obsproject.com/kb/window-capture-sources>
- Discord support — Capturing Application Window for Screen Share and Go Live:
  <https://support.discord.com/hc/en-us/articles/9410427556375--Windows-Capturing-Application-Window-for-Screen-Share-and-Go-Live>
- Blizzard End User License Agreement (last revised March 21, 2024):
  <https://www.blizzard.com/en-us/legal/fba4d00f-c7e4-4883-b8b9-1b4500a402ea/blizzard-end-user-license-agreement>
