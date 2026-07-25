"""`decky` 模块的本地类型桩,只声明本插件实际用到的名字(供 pyright;运行时由 Decky 注入)。

上游完整定义见 decky-loader `backend/decky_loader/plugin/imports/decky.py`。
用到新符号时在这里补一行 —— 别把上游整份 stub 抄回来,那 180 行里我们只碰这 6 个。
"""

import logging
from typing import Any

# 插件目录约定:settings/runtime/log 分开存放,不要写到 DECKY_HOME 之外。
DECKY_PLUGIN_DIR: str
DECKY_PLUGIN_SETTINGS_DIR: str
DECKY_PLUGIN_RUNTIME_DIR: str
DECKY_PLUGIN_LOG_DIR: str

logger: logging.Logger
"""写到 DECKY_PLUGIN_LOG_DIR 的插件日志器。"""

async def emit(event: str, *args: Any) -> None:
    """向前端推一条事件(前端 addEventListener 订阅)。"""
