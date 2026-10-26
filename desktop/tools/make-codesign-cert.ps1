# Crea un certificado de firma de codigo AUTOFIRMADO para LyricIsland en el almacen personal
# (Cert:\CurrentUser\My). Esto no cambia la confianza de Windows: solo permite firmar.
# Exporta la parte publica a desktop/build/codesign/LyricIsland-codesign.cer (se puede distribuir).
#
# Uso: powershell -ExecutionPolicy Bypass -File desktop/tools/make-codesign-cert.ps1
# (Archivo solo con caracteres ASCII: Windows PowerShell 5.1 lee los .ps1 sin BOM como ANSI.)
param(
    [string]$Subject = 'CN=LyricIsland',
    [int]$Years = 5
)
$ErrorActionPreference = 'Stop'

$existing = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -eq $Subject -and $_.NotAfter -gt (Get-Date) }
if ($existing) {
    $cert = $existing | Sort-Object NotAfter -Descending | Select-Object -First 1
    Write-Host "Ya existe un certificado valido: $($cert.Thumbprint) (vence $($cert.NotAfter))"
} else {
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject `
        -CertStoreLocation Cert:\CurrentUser\My -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
        -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears($Years) `
        -FriendlyName 'LyricIsland (firma de codigo autofirmada)'
    Write-Host "Certificado creado: $($cert.Thumbprint) (vence $($cert.NotAfter))"
}

$out = Join-Path $PSScriptRoot '..\build\codesign'
New-Item -ItemType Directory -Force $out | Out-Null
$cer = Join-Path $out 'LyricIsland-codesign.cer'
Export-Certificate -Cert $cert -FilePath $cer -Type CERT | Out-Null
Write-Host "Parte publica exportada: $((Resolve-Path $cer).Path)"
Write-Host "Subject (usar igual en appx.publisher): $($cert.Subject)"
