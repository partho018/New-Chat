#!/bin/bash
set -e

echo "📦 Building APK..."

export EXPO_TOKEN=pntN7hu9ilZPggq_nilIRaM-Erz_nF8hq2WGajVG

# Go to mobile app directory
cd "$(dirname "$0")"

# Run EAS build
eas build --platform android --profile preview --non-interactive

echo ""
echo "✅ Build submitted! Check https://expo.dev/accounts/partho018/projects/private-chat/builds for the download link."
