# 官方 SteamOS/Holo Rust 工具链 + alsa-sys 编译所需的 pkg-config 与 alsa 头文件。
# 固定工具链输入;实际产物仍须通过 check-binaries.py 的 GLIBC <= 2.39 检查。
FROM ghcr.io/steamdeckhomebrew/holo-toolchain-rust@sha256:818de45e147f35798c66498380b31bd1fe8bf75afdf0a22b027053706836faf1
RUN pacman -Sy --noconfirm pkgconf alsa-lib
