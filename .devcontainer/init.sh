#!/bin/bash


if grep -qEi "(microsoft|wsl)" /proc/version; then
  path="file:$(wslpath -w . | sed 's|\\|/|g')/.out/main.user.js"
else
  path="file:$PWD/.out/main.user.js"
fi

# header-dev.js is git-ignored: regenerate it from the tracked template.
sed "s#^// @require.*#// @require\t\t$path#" header-dev.template.js > header-dev.js
