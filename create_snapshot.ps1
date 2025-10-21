# 設定輸出檔案的名稱
$outputFile = "codebase_snapshot.txt"
# 取得目前腳本所在的目錄作為專案根目錄
$projectRoot = $PSScriptRoot

# --- 開始 ---
Write-Host "Starting snapshot creation..."
Write-Host "Project Root: $projectRoot"

# 在專案根目錄下執行，確保路徑正確
Set-Location $projectRoot

# 清空或建立新的輸出檔案
if (Test-Path $outputFile) {
    Clear-Content $outputFile
} else {
    New-Item -ItemType File -Path $outputFile | Out-Null
}

# 定義要包含的檔案/資料夾列表 (基於您的 8 批次清單)
$includePaths = @(
    ".gitignore",
    ".gitattributes",
    "package.json",
    "package-lock.json",
    "index.html",
    "style.css",
    "jest.config.js",
    "babel.config.js",
    ".eslintrc.json",
    ".prettierrc.json",
    "03-data-models",
    "04-core-code"
)

# 遍歷所有指定的路徑
Get-ChildItem -Path $includePaths -Recurse -ErrorAction SilentlyContinue | Where-Object { !$_.PSIsContainer } | ForEach-Object {
    # 取得相對於專案根目錄的路徑
    $relativePath = $_.FullName.Substring($projectRoot.Length + 1)
    # 將路徑中的 '\' 轉換為 '/'
    $normalizedPath = $relativePath.Replace("\", "/")

    # 寫入檔案標頭、內容與結尾
    Add-Content -Path $outputFile -Value "--- FILE START: $normalizedPath ---"
    Add-Content -Path $outputFile -Value (Get-Content $_.FullName -Raw -Encoding utf8)
    Add-Content -Path $outputFile -Value "--- FILE END ---`n"
}

# --- 最終驗證 ---
if ((Get-Item $outputFile).Length -gt 0) {
    Write-Host "Success: Codebase snapshot created: $outputFile"
} else {
    Write-Host "Warning: Snapshot file was created but is empty. Please check if the script is in the project root directory and if the paths in `$includePaths are correct."
}