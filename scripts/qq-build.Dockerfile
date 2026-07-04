# manylinux_2_28:glibc 2.28 < SteamOS,编译产物前向兼容;自带 gcc + 多版本 python。
# Nuitka 编译的启动器/libpython 链接构建环境 glibc,故必须在旧 glibc 里构建。
FROM quay.io/pypa/manylinux_2_28_x86_64
ENV PYBIN=/opt/python/cp311-cp311/bin
RUN dnf install -y patchelf && dnf clean all
# Nuitka standalone 需要静态 libpython(manylinux 默认只放归档,解开即可)
RUN cd /opt/_internal && tar xf static-libs-for-embedding-only.tar.xz
RUN $PYBIN/pip install --no-cache-dir nuitka curl_cffi qqmusic-api-python
