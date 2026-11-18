# Builds Horschamp's Linux release (AppImage, .deb) on the release Mac, in an x86_64 container (Rosetta on Apple
# Silicon): built and run by scripts/build-linux.sh, called by scripts/release-mac.sh.
#
# Ubuntu 22.04, the oldest supported one: the AppImage and the .deb then run on older glibc versions too. Rust, Node
# and pnpm are the Mac's own versions (build arguments), so both platforms of a release use the same tools.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
# Tauri's Linux dependencies, libsecret/libdbus for the keychain (Secret Service), then the build tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev \
      libsecret-1-dev build-essential pkg-config file \
      ca-certificates curl git unzip xz-utils \
 && rm -rf /var/lib/apt/lists/*

ARG RUST_VERSION
ARG NODE_VERSION
ARG PNPM_VERSION
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:/opt/node/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain "${RUST_VERSION:?}" --no-modify-path
RUN mkdir -p /opt/node \
 && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION:?}/node-v${NODE_VERSION}-linux-x64.tar.xz" | tar -xJ -C /opt/node --strip-components=1 \
 && npm install -g "pnpm@${PNPM_VERSION:?}"

# The AppImage bundler runs linuxdeploy and its appimage plugin, both AppImages: without FUSE in a container, they
# unpack themselves instead. Rosetta refuses to start an AppImage ("Exec format error") because of the AppImage mark in
# its ELF header (bytes 8 to 10, "AI\2"): the plugin is downloaded here with the mark wiped, where Tauri looks for it.
ENV APPIMAGE_EXTRACT_AND_RUN=1 CARGO_TARGET_DIR=/target
RUN mkdir -p /root/.cache/tauri \
 && curl -fsSL -o /root/.cache/tauri/linuxdeploy-plugin-appimage.AppImage \
      https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-x86_64.AppImage \
 && printf '\0\0\0' | dd of=/root/.cache/tauri/linuxdeploy-plugin-appimage.AppImage bs=1 seek=8 count=3 conv=notrunc \
 && chmod +x /root/.cache/tauri/linuxdeploy-plugin-appimage.AppImage \
 && /root/.cache/tauri/linuxdeploy-plugin-appimage.AppImage --plugin-api-version
WORKDIR /work
