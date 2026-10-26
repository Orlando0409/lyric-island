# Hace que ESTA PC confie en el certificado autofirmado de LyricIsland, para que Windows no bloquee
# el instalador ni la app y para poder instalar el paquete MSIX (.appx) sin la Microsoft Store.
#
# ATENCION: agrega un certificado a los almacenes de confianza del equipo. Cualquier programa firmado con
# ESTE certificado pasara a ser de confianza. Correlo solo en tus propias PCs y solo con el .cer de LyricIsland.
#
# Uso (PowerShell como administrador):
#   powershell -ExecutionPolicy Bypass -File "C:\ruta\a\trust-codesign-cert.ps1" [-CerPath "C:\ruta\a\LyricIsland-codesign.cer"]
# Para revertirlo: certlm.msc -> borrar el certificado de LyricIsland de Raiz de confianza, Editores de confianza y Personas de confianza.
#
# (Archivo solo con caracteres ASCII: Windows PowerShell 5.1 lee los .ps1 sin BOM como ANSI.)
param([string]$CerPath)
$ErrorActionPreference = 'Stop'

if (-not $CerPath) {
    # Busca el .cer junto al script (descarga de Releases) o en el repositorio (desktop/build/codesign).
    $candidates = @(
        (Join-Path $PSScriptRoot 'LyricIsland-codesign.cer'),
        (Join-Path $PSScriptRoot '..\build\codesign\LyricIsland-codesign.cer')
    )
    $CerPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $CerPath -or -not (Test-Path $CerPath)) { throw 'No se encontro LyricIsland-codesign.cer (pasalo con -CerPath).' }

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ejecuta este script en una PowerShell abierta como administrador.'
}

$cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2 (Resolve-Path $CerPath).Path
Write-Host "Certificado: $($cert.Subject)  (huella $($cert.Thumbprint), vence $($cert.NotAfter))"

foreach ($store in 'Root', 'TrustedPublisher', 'TrustedPeople') {
    Import-Certificate -FilePath $CerPath -CertStoreLocation "Cert:\LocalMachine\$store" | Out-Null
    Write-Host "[OK] Importado en LocalMachine\$store"
}
Write-Host 'Listo: el instalador firmado de LyricIsland y su MSIX ya son de confianza en esta PC.'
