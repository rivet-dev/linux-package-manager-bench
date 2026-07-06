#!/usr/bin/env bash
# Fedora dnf5. On Fedora `git` is a thin metapackage; the actual binary payload is
# `git-core`. Setup installs git fully (git + git-core + deps); the timed step
# reinstalls just `git-core` from cache (1 package, deps present) — the fair analog
# to the single `git` package other distros ship. Reinstall avoids orphaning the
# metapackage's perl-Git dep.
source "$(dirname "$0")/_lib.sh"
bench dnf fedora:latest \
  'dnf -y makecache && dnf install -y git' \
  'dnf download git-core --destdir=/tmp/rpms' \
  'dnf reinstall -y --cacheonly --disablerepo=* /tmp/rpms/git-core-[0-9]*.rpm' \
  'git --version'
