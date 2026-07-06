#!/usr/bin/env bash
# Arch pacman. -Sw downloads to the package cache; -S then installs from cache offline.
source "$(dirname "$0")/_lib.sh"
bench pacman archlinux:latest \
  'pacman -Sy --noconfirm' \
  'pacman -Sw --noconfirm git' \
  'pacman -S --noconfirm git' \
  'git --version'
