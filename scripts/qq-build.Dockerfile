# manylinux_2_28:glibc 2.28 < SteamOS,编译产物前向兼容;自带 gcc + 多版本 python。
# Nuitka 编译的启动器/libpython 链接构建环境 glibc,故必须在旧 glibc 里构建。
FROM quay.io/pypa/manylinux_2_28_x86_64
ENV PYBIN=/opt/python/cp311-cp311/bin
RUN dnf install -y patchelf && dnf clean all
# Nuitka standalone 需要静态 libpython(manylinux 默认只放归档,解开即可)
RUN cd /opt/_internal && tar xf static-libs-for-embedding-only.tar.xz
# 运行时依赖钉到 qq-provider/uv.lock 解析出的版本:发出的二进制必须与本地跑过测试的那份一致。
# 不钉会让上游随时改依赖树就静默炸构建(0.7.x 去掉 tarsio 那次),且发布不可重现。
# 升级流程:(cd qq-provider && uv lock --upgrade-package <pkg>) → 跑测试 → 同步改这里。
RUN $PYBIN/pip install --no-cache-dir nuitka curl_cffi==0.16.0 qqmusic-api-python==0.7.1
