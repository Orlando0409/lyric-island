# ADR-03: Electron frente a Tauri y WPF

- **Estado:** Aceptada
- **Fecha:** 2026-10-24

## Contexto

Hace falta una ventana transparente, siempre encima y click-through en Windows.

## Decisión

Electron + React + TypeScript, con un helper C# para SMTC.

## Motivos y consecuencias

Reutiliza React/TS y el núcleo TS; ventanas transparentes maduras; la Store acepta Electron. Costo: ~150 MB de RAM e instalador grande (medido: 118.5 MB con compresión máxima y solo es/en, bajo la meta de 120 MB). Plan B documentado: Tauri si el consumo resulta un problema real (R8).
