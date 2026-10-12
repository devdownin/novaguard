#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLASS_DIR="$(mktemp -d)"
trap 'rm -rf "$CLASS_DIR"' EXIT
javac -d "$CLASS_DIR" \
  "$ROOT/android/app/src/main/java/com/novaguard/surveillance/PresenceWindow.java" \
  "$ROOT/testing/native/PresenceWindowTest.java"
java -cp "$CLASS_DIR" PresenceWindowTest
