#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLASS_DIR="$(mktemp -d)"
trap 'rm -rf "$CLASS_DIR"' EXIT
javac -d "$CLASS_DIR" \
  "$ROOT/android/app/src/main/java/com/novaguard/surveillance/PresenceWindow.java" \
  "$ROOT/android/app/src/main/java/com/novaguard/surveillance/YuvPlanes.java" \
  "$ROOT/android/app/src/main/java/com/novaguard/surveillance/McpRules.java" \
  "$ROOT/android/app/src/main/java/com/novaguard/surveillance/McpRelayRules.java" \
  "$ROOT/android/app/src/main/java/com/novaguard/surveillance/McpPrompts.java" \
  "$ROOT/android/app/src/main/java/com/novaguard/surveillance/McpCertificates.java" \
  "$ROOT/testing/native/PresenceWindowTest.java" \
  "$ROOT/testing/native/YuvPlanesTest.java" \
  "$ROOT/testing/native/McpRulesTest.java" \
  "$ROOT/testing/native/McpRelayRulesTest.java" \
  "$ROOT/testing/native/McpPromptsTest.java" \
  "$ROOT/testing/native/McpCertificatesTest.java"
java -cp "$CLASS_DIR" PresenceWindowTest
java -cp "$CLASS_DIR" YuvPlanesTest
java -cp "$CLASS_DIR" McpRulesTest
java -cp "$CLASS_DIR" McpRelayRulesTest
java -cp "$CLASS_DIR" McpPromptsTest
java -cp "$CLASS_DIR" McpCertificatesTest
