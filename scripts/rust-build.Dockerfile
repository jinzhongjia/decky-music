# 官方 SteamOS/Holo Rust 工具链 + alsa-sys 编译所需的 pkg-config 与 alsa 头文件。
# glibc 随 SteamOS,产物拷到 Deck 不会 GLIBC not found。
FROM ghcr.io/steamdeckhomebrew/holo-toolchain-rust:latest
RUN pacman -Sy --noconfirm pkgconf alsa-lib
