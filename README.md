# LyricIsland

Isla dinámica flotante que muestra la **letra sincronizada (karaoke)** de lo que suena, con el **color de la carátula**, en **Windows** y **Android**. Sin cuentas, con cualquier reproductor.

```
desktop/          Electron + React + TS (isla, letra completa, ajustes, bandeja, atajos) · núcleo TS en src/core
desktop-helper/   Helper C# (.NET 10) que lee la sesión multimedia de Windows (SMTC) → NDJSON
android/          core/ (núcleo Kotlin JVM puro) · app/ (overlay Compose + servicios) · testplayer/
shared/fixtures/  Fixtures y golden files COMPARTIDOS por los tests de TS y Kotlin
docs/             Diseño y política de privacidad
tools/            Generador de fixtures
```

## Requisitos

Node.js 24+ y **pnpm**, **.NET 10 SDK**, Android Studio (JDK 21 + SDK 36).

## Windows

```bash
pnpm install
pnpm -C desktop exec install-electron
pnpm -C desktop helper:build
pnpm -C desktop dev
```

- `pnpm -C desktop dev:fake` — sin .NET ni reproductor: helper falso (sesión grabada) + LRCLIB falso local.
- `pnpm -C desktop test` / `coverage` — Vitest (núcleo, integración, golden). `pnpm -C desktop test:e2e` — Playwright (requiere `pnpm -C desktop build`).
- `pnpm -C desktop dist:nsis` — instalador NSIS (`desktop/dist`). `dist:msix` genera el paquete MSIX; en local requiere el Windows SDK y `ELECTRON_BUILDER_WINDOWS_KITS_PATH="C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64"` (en CI no hace falta).
- `pnpm -C desktop dist:store` — MSIX sin firmar para la Microsoft Store; incrementa automáticamente el número de parche y usa la identidad del producto en `desktop/build/store-identity.json` (no se sube al repositorio; formato en `store-identity.example.json`).
- `pnpm -C desktop dist:signed` — instalador y MSIX firmados con un certificado de firma de código propio (ver más abajo).
- Atajos: `Ctrl+Alt+L` mostrar/ocultar · `Ctrl+Alt+K` expandir/compactar · `Ctrl+Alt+J` letra completa · `Ctrl+Alt+→/←` desfase ±100 ms · `Ctrl+Alt+0` restablecer.
- El helper se puede correr solo en una terminal para ver los mensajes: `desktop/resources/helper/LyricIsland.MediaHelper.exe`.

### Firma con certificado propio

`desktop/tools/make-codesign-cert.ps1` crea un certificado autofirmado en el almacén personal y `dist:signed` lo usa. El nombre
del certificado se configura en `desktop/build/codesign.local.json` (`{ "subject": "CN=…" }`, no se sube) o con la variable
`LYRICISLAND_CERT_SUBJECT`. Un certificado autofirmado no es de confianza por defecto: en cada PC, una vez y como administrador,
`desktop/tools/trust-codesign-cert.ps1` lo agrega a los almacenes de confianza. Sin eso, SmartScreen avisa
("Más información" → "Ejecutar de todas formas").

## Android

```bash
cd android
./gradlew :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :testplayer:assembleDebug
```

Instalar `app-debug.apk`, abrir LyricIsland y tocar **Activar isla** (pide los permisos que falten).
`testplayer` publica una MediaSession controlable (`adb shell am start -n com.lyricisland.testplayer/.PlayerActivity --es cmd play|pause|seek|next --el pos 60000`).

## Tests

| Área | Verificación |
|---|---|
| Núcleo TS (parser LRC, sync, matcher, color OKLCH/WCAG, máquina de estados, orquestador, repositorio LRCLIB, romaji) | Vitest · cobertura ≥ 85 % de líneas |
| Paridad TS ↔ Kotlin | Golden files compartidos en `shared/fixtures/expected` |
| Helper C# | xUnit · contrato C# → zod validado en Vitest |
| App Windows | E2E con Playwright (helper falso + LRCLIB falso) |
| App Android | Tests del núcleo y de la app · tests instrumentados de Compose · lint |

Los fixtures (letras, carátulas, sesiones) son inventados o sintéticos.

## Privacidad y letras

La política de privacidad está en [`docs/privacy-policy.md`](docs/privacy-policy.md). Las letras vienen de
[LRCLIB](https://lrclib.net), una base de datos comunitaria y abierta; la app no incluye letras: solo guarda una caché local temporal en el dispositivo.

## Licencia

GPL-3.0 (`LICENSE`).
