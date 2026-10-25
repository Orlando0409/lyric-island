# ADR-04: Kotlin + Compose nativo en Android

- **Estado:** Aceptada
- **Fecha:** 2026-10-24

## Contexto

El corazón de la app en Android es nativo: overlay, servicios y MediaSession.

## Decisión

Kotlin + Jetpack Compose; el núcleo se porta a un módulo Kotlin JVM puro (android/core).

## Motivos y consecuencias

Renderizar React Native o Flutter dentro de una ventana overlay de un Service es frágil. La paridad con TS se garantiza con golden files compartidos (shared/fixtures/expected): 66 casos idénticos en ambos lenguajes.
