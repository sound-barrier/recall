<#
.SYNOPSIS
Reads the OCR evaluation's dumped crops with Windows.Media.Ocr and with a
pinned Tesseract, recording each reading and how long it took.

.DESCRIPTION
The Windows leg of .github/workflows/winocr-eval.yml. Its input is the
directory TestOCREval_Dump (pkg/parser/ocr_eval_test.go) wrote; its output
lands in the same directory, in the layout TestOCREval_Replay reads:

  text/<engine>/<image>/<key>.txt   the reading
  timings/<engine>.tsv              image, key, milliseconds, error
  versions/<engine>.txt             the build that read

Three engines read every recorded call:

  wmo-pre        Windows OCR on the preprocessed crop Tesseract saw
  wmo-raw        Windows OCR on the untouched source crop behind it
  tesseract-win  the pinned Tesseract on the preprocessed crop, with the
                 call's page-segmentation mode and whitelist, so the times
                 compare like for like on one machine

Run it under Windows PowerShell 5.1. The WinRT type projection it relies on
([Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime])
was removed from PowerShell 7.

.PARAMETER EvalDir
The directory the dump wrote: manifest.json, crops/pre and crops/raw.

.PARAMETER TesseractPath
The tesseract.exe to time against Windows OCR.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EvalDir,

    [Parameter(Mandatory = $true)]
    [string]$TesseractPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$InformationPreference = 'Continue'

# StorageFile takes only a full Windows path, backslashes and all.
$EvalDir = (Resolve-Path -LiteralPath $EvalDir).ProviderPath

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Foundation.IAsyncOperation`1, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapTransform, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

# WinRT hands back IAsyncOperation<T>, which PowerShell cannot await; the
# AsTask extension turns one into a .NET Task it can wait on.
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
        $_.Name -eq 'AsTask' -and
        $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } |
    Select-Object -First 1

$utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
$invariant = [System.Globalization.CultureInfo]::InvariantCulture
$timings = @{}

function Wait-WinRtOperation {
    param(
        [Parameter(Mandatory = $true)] $Operation,
        [Parameter(Mandatory = $true)] [type]$ResultType
    )
    $task = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $null = $task.Wait(-1)
    return $task.Result
}

function Get-WindowsOcrEngine {
    $language = New-Object Windows.Globalization.Language -ArgumentList 'en-US'
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
    if ($null -eq $engine) {
        Write-Warning -Message 'No en-US Windows OCR recognizer; falling back to the user profile languages.'
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    }
    if ($null -eq $engine) {
        $available = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }) -join ', '
        throw "Windows OCR has no recognizer for en-US or the user profile (installed: '$available'). Install the Language.OCR~~~en-US~0.0.1.0 capability."
    }
    return $engine
}

# Read-WindowsOcr reads one PNG, scaled down first when its longer side is
# past what the engine accepts, and returns its lines one to a line, as
# Tesseract prints them.
function Read-WindowsOcr {
    param(
        [Parameter(Mandatory = $true)] $Recognizer,
        [Parameter(Mandatory = $true)] [string]$Path
    )
    $file = Wait-WinRtOperation -Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) -ResultType ([Windows.Storage.StorageFile])
    $stream = Wait-WinRtOperation -Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) -ResultType ([Windows.Storage.Streams.IRandomAccessStream])
    try {
        $decoder = Wait-WinRtOperation -Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) -ResultType ([Windows.Graphics.Imaging.BitmapDecoder])
        $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
        $longest = [Math]::Max($decoder.PixelWidth, $decoder.PixelHeight)
        $limit = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
        if ($longest -gt $limit) {
            $transform.ScaledWidth = [uint32][Math]::Floor($decoder.PixelWidth * $limit / $longest)
            $transform.ScaledHeight = [uint32][Math]::Floor($decoder.PixelHeight * $limit / $longest)
            $transform.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Fant
        }
        $bitmapOperation = $decoder.GetSoftwareBitmapAsync(
            [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
            [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
            $transform,
            [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation,
            [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)
        $bitmap = Wait-WinRtOperation -Operation $bitmapOperation -ResultType ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Wait-WinRtOperation -Operation ($Recognizer.RecognizeAsync($bitmap)) -ResultType ([Windows.Media.Ocr.OcrResult])
        return (@($result.Lines | ForEach-Object { $_.Text }) -join "`n")
    }
    finally {
        if ($stream -is [System.IDisposable]) {
            $stream.Dispose()
        }
    }
}

# Read-Tesseract runs the binary the way pkg/tesseract does: the crop, stdout,
# the call's PSM, and its whitelist when it has one.
function Read-Tesseract {
    param(
        [Parameter(Mandatory = $true)] [string]$Path,
        [Parameter(Mandatory = $true)] [string]$Psm,
        [string]$Whitelist
    )
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $TesseractPath
    $info.Arguments = '"{0}" - --psm {1}' -f $Path, $Psm
    if ($Whitelist) {
        $info.Arguments += ' -c "tessedit_char_whitelist={0}"' -f $Whitelist
    }
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = $utf8
    $process = [System.Diagnostics.Process]::Start($info)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "tesseract exited $($process.ExitCode): $stderr"
    }
    return $stdout.Result
}

function Write-Utf8File {
    param(
        [Parameter(Mandatory = $true)] [string]$Path,
        [AllowEmptyString()] [string]$Text
    )
    $null = [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($Path))
    [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

# Measure-Reading times one engine's reading of one crop, file to text, and
# keeps the reading. A failed read is recorded with its error and no time.
function Measure-Reading {
    param(
        [Parameter(Mandatory = $true)] [string]$Label,
        [Parameter(Mandatory = $true)] [string]$ImageName,
        [Parameter(Mandatory = $true)] [string]$Key,
        [Parameter(Mandatory = $true)] [scriptblock]$Reader
    )
    if (-not $timings.ContainsKey($Label)) {
        $timings[$Label] = New-Object System.Collections.Generic.List[string]
    }
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $text = & $Reader
        $clock.Stop()
        Write-Utf8File -Path (Join-Path -Path $EvalDir -ChildPath "text\$Label\$ImageName\$Key.txt") -Text $text
        $timings[$Label].Add([string]::Format($invariant, "{0}`t{1}`t{2:0.###}`t", $ImageName, $Key, $clock.Elapsed.TotalMilliseconds))
    }
    catch {
        $clock.Stop()
        $message = ($_.Exception.Message -replace '\s+', ' ').Trim()
        Write-Warning -Message "$Label could not read $ImageName $Key`: $message"
        $timings[$Label].Add([string]::Format($invariant, "{0}`t{1}`t`t{2}", $ImageName, $Key, $message))
    }
}

$manifestPath = Join-Path -Path $EvalDir -ChildPath 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$recognizer = Get-WindowsOcrEngine
# Through cmd, which merges stderr, so a build that prints its version there
# still answers.
$tesseractVersion = (cmd.exe /c "`"$TesseractPath`" --version 2>&1" | Select-Object -First 1)
$windowsVersion = [System.Environment]::OSVersion.Version.ToString()
Write-Information -MessageData "Windows OCR $($recognizer.RecognizerLanguage.LanguageTag) on Windows $windowsVersion; $tesseractVersion"
Write-Utf8File -Path (Join-Path -Path $EvalDir -ChildPath 'versions\windows-ocr.txt') -Text "Windows.Media.Ocr $($recognizer.RecognizerLanguage.LanguageTag), Windows $windowsVersion"
Write-Utf8File -Path (Join-Path -Path $EvalDir -ChildPath 'versions\tesseract-win.txt') -Text $tesseractVersion

$calls = 0
foreach ($image in $manifest.images) {
    foreach ($call in $image.calls) {
        $pre = Join-Path -Path $EvalDir -ChildPath "crops\pre\$($image.image)\$($call.key).png"
        $raw = Join-Path -Path $EvalDir -ChildPath "crops\raw\$($image.image)\$($call.key).png"
        Measure-Reading -Label 'wmo-pre' -ImageName $image.image -Key $call.key -Reader { Read-WindowsOcr -Recognizer $recognizer -Path $pre }
        if (Test-Path -LiteralPath $raw) {
            Measure-Reading -Label 'wmo-raw' -ImageName $image.image -Key $call.key -Reader { Read-WindowsOcr -Recognizer $recognizer -Path $raw }
        }
        Measure-Reading -Label 'tesseract-win' -ImageName $image.image -Key $call.key -Reader { Read-Tesseract -Path $pre -Psm $call.psm -Whitelist $call.whitelist }
        $calls++
    }
    Write-Information -MessageData "read $($image.image)"
}

foreach ($label in $timings.Keys) {
    Write-Utf8File -Path (Join-Path -Path $EvalDir -ChildPath "timings\$label.tsv") -Text (($timings[$label] -join "`n") + "`n")
}
Write-Information -MessageData "Read $calls recorded calls across $(@($manifest.images).Count) screenshots."
