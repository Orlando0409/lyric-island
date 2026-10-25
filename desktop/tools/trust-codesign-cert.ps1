# Hace que ESTA PC confíe en el certificado autofirmado de LyricIsland, para que Windows no bloquee
# el instalador ni la app y para poder instalar el paquete MSIX (.appx) sin la Microsoft Store.
#
# ⚠️ Agrega un certificado a los almacenes de confianza del equipo. Cualquier programa firmado con ESTE
#    certificado pasará a ser de confianza. Correlo solo en tus propias PCs y solo con el .cer de LyricIsland.
#
# Uso (PowerShell como administrador):
#   powershell -ExecutionPolicy Bypass -File trust-codesign-cert.ps1 [-CerPath LyricIsland-codesign.cer]
# Para revertirlo: certlm.msc → borrar "OB Dev Studio" de Raíz de confianza, Editores de confianza y Personas de confianza.
param([string]$CerPath = (Join-Path $PSScriptRoot '..\build\codesign\LyricIsland-codesign.cer'))
$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ejecutá este script en una PowerShell abierta como administrador.'
}
if (-not (Test-Path $CerPath)) { throw "No se encontró el certificado: $CerPath" }

foreach ($store in 'Root', 'TrustedPublisher', 'TrustedPeople') {
    Import-Certificate -FilePath $CerPath -CertStoreLocation "Cert:\LocalMachine\$store" | Out-Null
    Write-Host "✓ Importado en LocalMachine\$store"
}
Write-Host 'Listo: el instalador firmado de LyricIsland y su MSIX ya son de confianza en esta PC.'
