$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$navy = [System.Drawing.Color]::FromArgb(255, 31, 75, 110)
$cream = [System.Drawing.Color]::FromArgb(255, 244, 239, 228)
$fontName = "Palatino Linotype"
$installed = [System.Drawing.FontFamily]::Families | ForEach-Object { $_.Name }
if ($installed -notcontains $fontName) { $fontName = "Georgia" }
if ($installed -notcontains $fontName) { $fontName = "Times New Roman" }
$family = New-Object System.Drawing.FontFamily $fontName

function New-IconBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $inset = [Math]::Max(0.5, $size * 0.02)
    $circle = New-Object System.Drawing.Drawing2D.GraphicsPath
    $circle.AddEllipse([float]$inset, [float]$inset, [float]($size - 2 * $inset), [float]($size - 2 * $inset))
    $navyBrush = New-Object System.Drawing.SolidBrush $navy
    $g.FillPath($navyBrush, $circle)
    $navyBrush.Dispose()
    $g.SetClip($circle)

    $em = [float]($size * 0.78)
    $nPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $nPath.FillMode = [System.Drawing.Drawing2D.FillMode]::Winding
    $nPath.AddString(
        "N",
        $family,
        [int][System.Drawing.FontStyle]::Bold,
        $em,
        [System.Drawing.PointF]::new(0, 0),
        [System.Drawing.StringFormat]::GenericTypographic
    )
    $box = $nPath.GetBounds()
    $m = New-Object System.Drawing.Drawing2D.Matrix
    $m.Translate(
        (($size - $box.Width) / 2.0 - $box.X + ($size * 0.11)),
        (($size - $box.Height) / 2.0 - $box.Y + ($size * 0.12))
    )
    $nPath.Transform($m)
    $m.Dispose()

    $creamBrush = New-Object System.Drawing.SolidBrush $cream
    $g.FillPath($creamBrush, $nPath)
    $creamBrush.Dispose()
    $nPath.Dispose()
    $circle.Dispose()
    $g.Dispose()
    return $bmp
}

function Get-PngBytes([System.Drawing.Bitmap]$bmp) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return $bytes
}

$project = Split-Path $PSScriptRoot -Parent
$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$images = New-Object System.Collections.Generic.List[byte[]]
foreach ($size in $sizes) {
    $bmp = New-IconBitmap $size
    $preview = Join-Path $project ("electron\icon-" + $size + ".png")
    $bmp.Save($preview, [System.Drawing.Imaging.ImageFormat]::Png)
    $images.Add((Get-PngBytes $bmp))
    $bmp.Dispose()
}

$icoPath = Join-Path $project "electron\notex.ico"
$count = $images.Count
$stream = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter $stream
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$count)
$offset = 6 + (16 * $count)
for ($i = 0; $i -lt $count; $i++) {
    $bytes = $images[$i]
    $size = $sizes[$i]
    $wh = 0
    if ($size -lt 256) { $wh = $size }
    $bw.Write([byte]$wh)
    $bw.Write([byte]$wh)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$bytes.Length)
    $bw.Write([uint32]$offset)
    $offset += $bytes.Length
}
foreach ($bytes in $images) { $bw.Write($bytes) }
$bw.Flush()
$bw.Close()
Copy-Item -Force $icoPath (Join-Path $project "electron\icon.ico")

$iconDir = Join-Path $env:LOCALAPPDATA "NoTeX"
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$appIco = Join-Path $iconDir "notex-app-$stamp.ico"
Copy-Item -Force $icoPath $appIco

$desktop = [Environment]::GetFolderPath("Desktop")
$electron = Join-Path $project "node_modules\electron\dist\electron.exe"
$lnkPath = Join-Path $desktop "NoTeX.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = $electron
$shortcut.Arguments = "`"$project`""
$shortcut.WorkingDirectory = $project
$shortcut.WindowStyle = 1
$shortcut.Description = "NoTeX"
$shortcut.IconLocation = "$appIco,0"
$shortcut.Save()

$ie4 = Join-Path $env:SystemRoot "System32\ie4uinit.exe"
if (Test-Path $ie4) {
    Start-Process -FilePath $ie4 -ArgumentList "-show" -Wait -WindowStyle Hidden
}

Write-Output "FONT=$fontName"
Write-Output "ICO=$icoPath size=$((Get-Item $icoPath).Length)"
Write-Output "APPICO=$appIco"
Write-Output "LNK=$lnkPath"
