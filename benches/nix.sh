#!/usr/bin/env bash
# Nix. Setup enables flakes, drops the base image's git-minimal (avoids a profile
# conflict) and pre-warms the nixpkgs eval WITHOUT realizing git's closure (nix eval
# forces the derivation, not the build). DOWNLOAD then substitutes the whole closure
# into /nix/store; INSTALL is just an atomic profile-generation symlink flip.
source "$(dirname "$0")/_lib.sh"
bench nix nixos/nix \
  'echo "experimental-features = nix-command flakes" >> /etc/nix/nix.conf; nix profile remove git-minimal 2>/dev/null || nix-env -e git-minimal 2>/dev/null || true; nix eval nixpkgs#git.outPath >/dev/null 2>&1 || true' \
  'nix build nixpkgs#git --no-link --print-out-paths' \
  'nix profile install nixpkgs#git' \
  '/root/.nix-profile/bin/git --version'
