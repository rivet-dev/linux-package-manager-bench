#!/usr/bin/env bash
# Debian apt. Setup installs git + deps then removes ONLY git (deps stay); the
# timed install re-adds just the git package from cache. Measures git alone.
source "$(dirname "$0")/_lib.sh"
bench apt debian:12-slim \
  'apt-get update -qq && apt-get install -y git && apt-get remove -y git && apt-get clean' \
  'apt-get install -y --download-only git' \
  'apt-get install -y git' \
  'git --version'
