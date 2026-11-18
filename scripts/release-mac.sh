#!/usr/bin/env bash
# Publishes a version of Horschamp from this Mac, for macOS and Linux, without GitHub Actions:
#   1. checks that Docker runs and that main is clean and pushed;
#   2. bumps the version (unless it is already the one to publish), commits, tags v<version> and pushes both;
#   3. builds the universal .dmg (Apple Silicon + Intel) here, then the Linux AppImage and .deb in Docker
#      (scripts/build-linux.sh);
#   4. creates the GitHub release v<version> with those files (gh).
#
#   scripts/release-mac.sh                  asks fix / minor / major, then the whole release
#   scripts/release-mac.sh 0.1.0            releases this exact version (no bump if it is already in Cargo.toml)
#   scripts/release-mac.sh --dry-run        builds what is on main: no bump, no push, no upload
#
# APPLE_SIGNING_IDENTITY (a "Developer ID Application" certificate in your keychain) signs the app; without it the
# app is ad-hoc signed, and users allow it once in System Settings › Privacy & Security.
set -euo pipefail
cd "$(dirname "$0")/.."

mode=release
wanted=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) mode=dry ;;
    [0-9]*.[0-9]*.[0-9]*) wanted="$arg" ;;
    *) echo "usage: scripts/release-mac.sh [<version> | --dry-run]" >&2; exit 2 ;;
  esac
done
fail() { echo "release-mac: $1" >&2; exit 1; }
current_version() { sed -n 's/^version = "\(.*\)"$/\1/p' src-tauri/Cargo.toml | head -1; }

[[ "$(uname -s)" == Darwin ]] || fail "run it on a Mac"
command -v gh >/dev/null || fail "gh (GitHub CLI) is required"
docker info >/dev/null 2>&1 || fail "Docker is not running: start Docker Desktop (or OrbStack), it builds the Linux files"
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null

echo "== Git"
git fetch --quiet origin main --tags
[[ "$(git branch --show-current)" == main ]] || fail "switch to main"
[[ -z "$(git status --porcelain)" ]] || fail "uncommitted or untracked files (git status)"
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || fail "main is not origin/main: push or pull first"
echo "  ok    main = origin/main, nothing local"

version="$(current_version)"
if [[ $mode == release ]]; then
  next="$wanted"
  if [[ -z "$next" ]]; then
    IFS=. read -r major minor patch <<<"$version"
    echo "== New version (now $version)"
    echo "  1) fix     $major.$minor.$((patch + 1))"
    echo "  2) minor   $major.$((minor + 1)).0"
    echo "  3) major   $((major + 1)).0.0"
    read -r -p "  Which one? [1/2/3] " choice
    case "$choice" in
      1) next="$major.$minor.$((patch + 1))" ;;
      2) next="$major.$((minor + 1)).0" ;;
      3) next="$((major + 1)).0.0" ;;
      *) fail "nothing chosen: no release" ;;
    esac
  fi
  git rev-parse -q --verify "refs/tags/v$next" >/dev/null && fail "tag v$next already exists"
  if [[ "$next" != "$version" ]]; then
    # The version lives in src-tauri/Cargo.toml, Cargo.lock, tauri.conf.json and package.json.
    perl -0pi -e "s/^version = \"\Q$version\E\"/version = \"$next\"/m" src-tauri/Cargo.toml
    perl -0pi -e "s/\"version\": \"\Q$version\E\"/\"version\": \"$next\"/" package.json src-tauri/tauri.conf.json
    (cd src-tauri && cargo update --workspace --offline --quiet)
    [[ "$(current_version)" == "$next" ]] || fail "could not bump the version (git checkout . to undo)"
    git add src-tauri/Cargo.toml src-tauri/Cargo.lock package.json src-tauri/tauri.conf.json
    git commit --quiet -m "release: version $next"
  fi
  git tag -a "v$next" -m "Horschamp $next"
  git push --quiet --atomic origin main "v$next"
  echo "  ok    v$next pushed"
  version="$next"
fi
ref="v$version"
[[ $mode == dry ]] && ref=HEAD

mkdir -p dist-release
find dist-release -mindepth 1 -maxdepth 1 -type f -delete
mac="horschamp-$version-universal"
linux="horschamp-$version-amd64"

echo "== Build Horschamp $version (universal-apple-darwin)"
pnpm install --frozen-lockfile
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"
[[ "$APPLE_SIGNING_IDENTITY" == - ]] && echo "  !!    no APPLE_SIGNING_IDENTITY: ad-hoc signature, not notarized"
pnpm tauri build --target universal-apple-darwin --bundles app,dmg
cp "$(ls src-tauri/target/universal-apple-darwin/release/bundle/dmg/Horschamp_"$version"_*.dmg | head -1)" \
  "dist-release/$mac.dmg"
echo "  ok    dist-release/$mac.dmg ($(du -h "dist-release/$mac.dmg" | cut -f1))"
git diff --quiet || fail "the build modified tracked files (git status): fix that before publishing"

scripts/build-linux.sh "$ref" dist-release

if [[ $mode == dry ]]; then
  echo "== Dry run: nothing uploaded"
  exit 0
fi

echo "== GitHub release $ref"
prev="$(git describe --tags --abbrev=0 "$ref^" 2>/dev/null || git rev-list --max-parents=0 HEAD)"
notes="Unofficial desktop client for the Higgsfield API. Not affiliated with or endorsed by Higgsfield.

| Platform | File |
| --- | --- |
| macOS (Apple Silicon + Intel) | \`$mac.dmg\` |
| Linux x86_64 | \`$linux.AppImage\` |
| Debian / Ubuntu | \`$linux.deb\` |

macOS builds are not notarized: the first time, right-click the app and choose Open (or allow it in System Settings › Privacy & Security).

**Changes**
$(git log --oneline --no-merges "$prev..$ref" | sed 's/^[0-9a-f]* /- /')"
gh release create "$ref" --title "Horschamp $version" --notes "$notes" \
  "dist-release/$mac.dmg" "dist-release/$linux.AppImage" "dist-release/$linux.deb"
echo "== Done: $(gh release view "$ref" --json url -q .url)"
