[CmdletBinding()]
param(
    [string]$SourceZip,
    [string]$DestinationDirectory
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression

if ([string]::IsNullOrWhiteSpace($SourceZip)) {
    Add-Type -AssemblyName System.Windows.Forms
    $gtfsDialog = New-Object System.Windows.Forms.OpenFileDialog
    $gtfsDialog.Title = '다운로드한 원본 GTFS ZIP을 선택하세요'
    $gtfsDialog.Filter = 'ZIP 파일 (*.zip)|*.zip'
    try {
        if ($gtfsDialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
            Write-Host '파일 선택을 취소했습니다.'
            return
        }
        $SourceZip = $gtfsDialog.FileName
    }
    finally {
        $gtfsDialog.Dispose()
    }
}

$gtfsSource = Get-Item -LiteralPath $SourceZip
if ($gtfsSource.PSIsContainer -or $gtfsSource.Extension -ine '.zip') {
    throw '압축을 풀지 않은 원본 ZIP 파일을 선택해 주세요.'
}
if ([string]::IsNullOrWhiteSpace($DestinationDirectory)) {
    $gtfsFolderName = 'GTFS-upload-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $DestinationDirectory = Join-Path $gtfsSource.DirectoryName $gtfsFolderName
}
if (Test-Path -LiteralPath $DestinationDirectory) {
    throw '출력 폴더가 이미 있습니다. 기존 파일을 덮어쓰지 않도록 새 폴더를 지정해 주세요.'
}
$gtfsOutput = New-Item -ItemType Directory -Path $DestinationDirectory

# 원본은 읽기 전용으로 열고, 전송 한도보다 작은 독립 ZIP에 조각을 담는다.
$gtfsInput = [System.IO.File]::OpenRead($gtfsSource.FullName)
$gtfsBuffer = New-Object byte[] (29MB)
$gtfsParts = New-Object 'System.Collections.Generic.List[object]'
try {
    $gtfsSourceBytes = $gtfsInput.Length
    while (($gtfsRead = $gtfsInput.Read($gtfsBuffer, 0, $gtfsBuffer.Length)) -gt 0) {
        $gtfsName = 'gtfs-part-{0:D6}.zip' -f ($gtfsParts.Count + 1)
        $gtfsTarget = [System.IO.File]::Open(
            (Join-Path $gtfsOutput.FullName $gtfsName),
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write
        )
        try {
            $gtfsArchive = [System.IO.Compression.ZipArchive]::new(
                $gtfsTarget, [System.IO.Compression.ZipArchiveMode]::Create, $true
            )
            try {
                $gtfsEntry = $gtfsArchive.CreateEntry('payload.bin', [System.IO.Compression.CompressionLevel]::NoCompression)
                $gtfsPayload = $gtfsEntry.Open()
                try {
                    $gtfsPayload.Write($gtfsBuffer, 0, $gtfsRead)
                }
                finally {
                    $gtfsPayload.Dispose()
                }
            }
            finally {
                $gtfsArchive.Dispose()
            }
        }
        finally {
            $gtfsTarget.Dispose()
        }
        $gtfsParts.Add([ordered]@{ file = $gtfsName; bytes = $gtfsRead })
        Write-Host ('생성: ' + $gtfsName)
    }
    $gtfsHash = (Get-FileHash -LiteralPath $gtfsSource.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
finally {
    $gtfsInput.Dispose()
}

$gtfsManifest = [ordered]@{
    version = 1
    originalName = $gtfsSource.Name
    originalBytes = $gtfsSourceBytes
    sha256 = $gtfsHash
    parts = @($gtfsParts.ToArray())
} | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText(
    (Join-Path $gtfsOutput.FullName 'manifest.json'),
    $gtfsManifest,
    [System.Text.UTF8Encoding]::new($false)
)
Write-Host ('완료: ' + $gtfsOutput.FullName)
Write-Host '이 폴더 안의 ZIP 파일 전부와 manifest.json을 대화에 첨부해 주세요. 여러 번 나눠 첨부해도 됩니다.'
if ($env:OS -eq 'Windows_NT') {
    Start-Process explorer.exe -ArgumentList ('"' + $gtfsOutput.FullName + '"')
}
