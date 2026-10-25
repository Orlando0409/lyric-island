# ADR-05: helper C# por stdio (NDJSON)

- **Estado:** Aceptada
- **Fecha:** 2026-10-24

## Contexto

Electron no accede a WinRT directamente.

## Decisión

Proceso hijo LyricIsland.MediaHelper.exe que emite un JSON por línea; Electron lo valida con zod y lo reinicia con backoff.

## Motivos y consecuencias

Aislamiento de fallos, depuración en la terminal, sin addons nativos por versión de Electron. Native AOT requiere las herramientas de C++ de Visual Studio; sin ellas tools/build-helper.mjs publica self-contained + trimmed (14 MB).
