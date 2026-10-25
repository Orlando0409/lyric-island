# ADR-02: no usar la cuenta de Spotify

- **Estado:** Aceptada
- **Fecha:** 2026-10-24

## Contexto

Spotify ofrece letras y Canvas solo con sesión de usuario.

## Decisión

Solo la sesión multimedia del sistema (SMTC / MediaSession) + LRCLIB. Cero cuentas, cero tokens.

## Motivos y consecuencias

Requisito explícito del producto. La Web API requiere OAuth; la API interna requiere la cookie sp_dc, viola los ToS y se rompe seguido. Consecuencia positiva: funciona con cualquier reproductor. Negativa: sin Canvas.
