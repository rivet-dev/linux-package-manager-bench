#!/usr/bin/env bash
# Alpine apk. Setup installs git's deps by name (from a --simulate of `apk add git`,
# excluding git itself); the timed install adds just the git .apk from cache offline.
source "$(dirname "$0")/_lib.sh"
bench apk alpine:latest \
  'apk update -q && apk add $(apk add --simulate git 2>&1 | sed -n "s/.*Installing \([^ ]*\).*/\1/p" | grep -vx git) && mkdir -p /tmp/apks' \
  'cd /tmp/apks && apk fetch git' \
  'apk add --no-network --allow-untrusted /tmp/apks/git-[0-9]*.apk' \
  'git --version'
