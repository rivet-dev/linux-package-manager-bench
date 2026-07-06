#!/usr/bin/env bash
# Debian apt. --download-only caches .debs; a second install runs from cache offline.
source "$(dirname "$0")/_lib.sh"
bench apt debian:12-slim \
  'apt-get update -qq' \
  'apt-get install -y --download-only git' \
  'apt-get install -y git' \
  'git --version'
