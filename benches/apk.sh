#!/usr/bin/env bash
# Alpine apk. Fetch recursively to /tmp/apks, then install from local files offline.
source "$(dirname "$0")/_lib.sh"
bench apk alpine:latest \
  'apk update -q; mkdir -p /tmp/apks' \
  'cd /tmp/apks && apk fetch --recursive git' \
  'apk add --no-network --allow-untrusted /tmp/apks/*.apk' \
  'git --version'
