# manylinux_2_28:glibc 2.28 < SteamOS,编译产物前向兼容;自带 gcc + 多版本 python。
# Nuitka 编译的启动器/libpython 链接构建环境 glibc,故必须在旧 glibc 里构建。
FROM quay.io/pypa/manylinux_2_28_x86_64
ENV PYBIN=/opt/python/cp311-cp311/bin
RUN dnf install -y patchelf && dnf clean all
# Nuitka standalone 需要静态 libpython(manylinux 默认只放归档,解开即可)
RUN cd /opt/_internal && tar xf static-libs-for-embedding-only.tar.xz
# 全部钉版本 —— 钉的是构建**输入**:运行时依赖对齐 qq-provider/uv.lock,发出的二进制
# 用的就是本地跑过测试的那几个库版本。不钉的话上游随时改依赖树就静默炸构建
# (0.7.x 去掉 tarsio 那次),或者悄悄换掉一个没人测过的库版本。
#
# nuitka 也必须钉(issue #47):它是编译器而非运行时依赖,但换版本一样会改二进制
# (代码生成、standalone 布局、隐式 include 行为都可能变),浮动就等于每次发版都在赌
# 一个没验证过的编译器。
#
# 注意别误解成 byte-reproducible:实测同样的 pin 重建两次,主可执行文件 sha256 仍然不同
# (Nuitka/gcc 会把构建路径、时间戳之类嵌进产物)。所以发版时的指纹只能取自**那一次**
# 构建的产物,不能拿「重建一遍对得上」当校验手段。
#
# 升级流程:
#   运行时依赖 —— (cd qq-provider && uv lock --upgrade-package <pkg>) → 跑测试 → 同步改这里
#   nuitka     —— 单独一次提交改版本号 → 重建 → 真机验一遍 QQ 端(登录/搜索/播放)
RUN $PYBIN/pip install --no-cache-dir \
      nuitka==4.1.3 \
      curl_cffi==0.16.0 \
      qqmusic-api-python==0.7.2
