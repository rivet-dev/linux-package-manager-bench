#!/usr/bin/env bash
# Homebrew (Linuxbrew). Setup clones the homebrew-core tap (SLOW, minutes) so the
# timed phases only fetch/pour bottles, and uninstalls any pre-existing git.
# NO_INSTALL_FROM_API pins to the local tap (deterministic; avoids an API-path bug on
# the noarch ca-certificates bottle). `brew fetch --deps` caches every dependency
# bottle; `brew install` then pours them from cache offline.
source "$(dirname "$0")/_lib.sh"
bench brew homebrew/brew \
  'HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_FROM_API=1 brew tap homebrew/core 2>/dev/null; brew uninstall --ignore-dependencies --force git 2>/dev/null || true' \
  'HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_FROM_API=1 brew fetch --deps git' \
  'HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_FROM_API=1 brew install git' \
  'git --version'
