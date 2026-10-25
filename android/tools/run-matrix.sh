#!/usr/bin/env bash
# Matriz de pruebas Android (sección 15.6) en emuladores: por cada AVD arranca el emulador, corre los tests
# instrumentados y una prueba de humo con testplayer (la isla debe aparecer con el servicio activo).
# Uso: android/tools/run-matrix.sh LI_API31 LI_API33 LI_API34 ...
set -u
export MSYS_NO_PATHCONV=1
# Solo el emulador (adb y connectedAndroidTest respetan ANDROID_SERIAL): un teléfono conectado no se toca.
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
SDK="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
ADB="$SDK/platform-tools/adb"
EMU="$SDK/emulator/emulator"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/matrix"
mkdir -p "$OUT"
: > "$OUT/results.md"

for AVD in "$@"; do
  echo "== $AVD"
  "$EMU" -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect >"$OUT/$AVD-emu.log" 2>&1 &
  # Espera el arranque con un tope de 10 min (p. ej. sin espacio en disco el emulador no arranca).
  BOOTED=0
  for _ in $(seq 1 120); do
    [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && BOOTED=1 && break
    sleep 5
  done
  if [ "$BOOTED" = 0 ]; then
    echo "| $AVD | — | ❌ el emulador no arrancó (ver $AVD-emu.log) | — |" | tee -a "$OUT/results.md"
    "$ADB" emu kill >/dev/null 2>&1
    continue
  fi
  sleep 20 # dejar que System UI termine de arrancar
  API=$("$ADB" shell getprop ro.build.version.sdk | tr -d '\r')

  (cd "$ROOT" && ./gradlew :app:connectedDebugAndroidTest --console=plain -q >"$OUT/$AVD-tests.log" 2>&1)
  TESTS=$([ $? -eq 0 ] && echo "✅" || echo "❌")

  "$ADB" install -r "$ROOT/app/build/outputs/apk/debug/app-debug.apk" >/dev/null
  "$ADB" install -r "$ROOT/testplayer/build/outputs/apk/debug/testplayer-debug.apk" >/dev/null
  "$ADB" shell appops set com.lyricisland.app SYSTEM_ALERT_WINDOW allow
  "$ADB" shell cmd notification allow_listener com.lyricisland.app/com.lyricisland.app.media.MediaListenerService
  [ "$API" -ge 33 ] && "$ADB" shell pm grant com.lyricisland.app android.permission.POST_NOTIFICATIONS
  # Activa la isla sin tocar la UI (extra solo disponible en builds de debug).
  "$ADB" shell am start -n com.lyricisland.app/.MainActivity --ez enableIsland true >/dev/null
  sleep 25
  "$ADB" shell am start -n com.lyricisland.testplayer/.PlayerActivity --es cmd play --el pos 60000 >/dev/null
  sleep 3
  "$ADB" shell input keyevent KEYCODE_HOME
  sleep 15
  "$ADB" exec-out screencap -p >"$OUT/$AVD.png"
  RUNNING=$("$ADB" shell dumpsys activity services com.lyricisland.app | grep -c IslandOverlayService)
  CRASH=$("$ADB" logcat -d -b crash | grep -c "com.lyricisland")
  SMOKE=$([ "$RUNNING" -gt 0 ] && [ "$CRASH" -eq 0 ] && echo "✅" || echo "❌ (servicio=$RUNNING, crashes=$CRASH)")
  echo "| $AVD | API $API | tests instrumentados $TESTS | isla + testplayer $SMOKE |" | tee -a "$OUT/results.md"

  "$ADB" emu kill >/dev/null 2>&1
  sleep 10
done
