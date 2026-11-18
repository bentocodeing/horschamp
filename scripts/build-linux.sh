#!/usr/bin/env bash
# Builds Horschamp's Linux release files on this Mac, in Docker (x86_64 Ubuntu 22.04, docker/release-linux.Dockerfile):
#   horschamp-<version>-amd64.AppImage and horschamp-<version>-amd64.deb
#
#   scripts/build-linux.sh                    what is committed on HEAD, into dist-release/
#   scripts/build-linux.sh v0.1.0 out/        a tag (or any commit), into out/
#
# Only committed files are built (git archive): what is published is what the tag holds. Called by
# scripts/release-mac.sh. Compiled dependencies live in Docker volumes (horschamp-release-linux-*): the first build is
# long (under Rosetta), the next ones only rebuild Horschamp. `docker volume rm` them to start from scratch.
set -euo pipefail
cd "$(dirname "$0")/.."

ref="${1:-HEAD}"
out="${2:-dist-release}"
fail() { echo "build-linux: $1" >&2; exit 1; }

git rev-parse -q --verify "$ref^{commit}" >/dev/null || fail "unknown commit or tag: $ref"
version="$(git show "$ref:src-tauri/Cargo.toml" | sed -n 's/^version = "\(.*\)"$/\1/p' | head -1)"
[[ -n "$version" ]] || fail "no version in $ref:src-tauri/Cargo.toml"
command -v docker >/dev/null || fail "Docker is required (Docker Desktop, OrbStack…)"
docker info >/dev/null 2>&1 || fail "Docker is not running: start Docker Desktop (or OrbStack) and try again"

rust="$(rustc --version | cut -d' ' -f2)"
node="$(node --version | sed 's/^v//')"
pnpm="$(pnpm --version)"
image=horschamp-release-linux
echo "== Linux image (Ubuntu 22.04 x86_64, Rust $rust, Node $node, pnpm $pnpm)"
docker build --quiet --platform linux/amd64 -f docker/release-linux.Dockerfile \
  --build-arg RUST_VERSION="$rust" --build-arg NODE_VERSION="$node" --build-arg PNPM_VERSION="$pnpm" \
  -t "$image" docker >/dev/null

mkdir -p "$out"
out="$(cd "$out" && pwd)"
name="horschamp-$version-amd64"
rm -f "${out:?}/${name:?}.AppImage" "${out:?}/${name:?}.deb"

echo "== Build Horschamp $version for Linux ($ref)"
volumes=(
  -v horschamp-release-linux-target:/target
  -v horschamp-release-linux-cargo:/opt/cargo/registry
  -v horschamp-release-linux-pnpm:/root/.local/share/pnpm/store
  -v "$out":/out
)
git archive --format=tar "$ref" | docker run --rm -i --platform linux/amd64 "${volumes[@]}" \
  -e VERSION="$version" -e NAME="$name" "$image" bash -c '
    set -euo pipefail
    tar -x -C /work
    pnpm install --frozen-lockfile
    pnpm tauri build --target x86_64-unknown-linux-gnu --bundles appimage,deb
    bundle=/target/x86_64-unknown-linux-gnu/release/bundle
    cp "$(ls "$bundle"/appimage/Horschamp_"$VERSION"_amd64.AppImage)" "/out/$NAME.AppImage"
    cp "$(ls "$bundle"/deb/Horschamp_"$VERSION"_amd64.deb)" "/out/$NAME.deb"
  '
for f in "$name.AppImage" "$name.deb"; do
  [[ -s "$out/$f" ]] || fail "$f was not built"
done
echo "  ok    $out/$name.AppImage ($(du -h "$out/$name.AppImage" | cut -f1)), $name.deb"
