#!/usr/bin/env bash
# Homebrew (Linuxbrew). Setup clones the tap and installs all of git's deps
# (`brew deps git`) but not git; the timed install pours just the git bottle from
# cache. NO_INSTALL_FROM_API pins to the local tap (deterministic).
source "$(dirname "$0")/_lib.sh"
bench brew homebrew/brew \
  'export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_FROM_API=1; brew tap homebrew/core 2>/dev/null; brew install $(brew deps git); brew uninstall --ignore-dependencies --force git 2>/dev/null || true' \
  'HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_FROM_API=1 brew fetch git' \
  'HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_FROM_API=1 brew install git' \
  'git --version'
