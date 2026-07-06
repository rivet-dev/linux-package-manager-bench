#!/usr/bin/env bash
# Fedora dnf5. `dnf download --resolve` caches RPMs; install from local RPMs offline.
# makecache in setup so the download phase measures package bytes, not repo metadata.
source "$(dirname "$0")/_lib.sh"
bench dnf fedora:latest \
  'dnf -y makecache' \
  'dnf download --resolve --destdir=/tmp/rpms git' \
  'dnf install -y --cacheonly --disablerepo=* /tmp/rpms/*.rpm' \
  'git --version'
