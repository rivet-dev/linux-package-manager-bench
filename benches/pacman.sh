#!/usr/bin/env bash
# Arch pacman. Setup installs git + deps then removes ONLY git (`-Rdd` keeps deps);
# the timed install re-adds just git from cache. Measures git alone.
source "$(dirname "$0")/_lib.sh"
bench pacman archlinux:latest \
  'pacman -Sy --noconfirm && pacman -S --noconfirm git && pacman -Rdd --noconfirm git' \
  'pacman -Sw --noconfirm git' \
  'pacman -S --noconfirm git' \
  'git --version'
