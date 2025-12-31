"""配置管理模块

提供用于加载、更新、删除并保存插件配置的单例类。
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path

import decky
from backend.types import FrontendSettings


class ConfigManager:
    """负责管理插件配置的单例类"""

    _instance: ConfigManager | None = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if getattr(self, "_initialized", False):
            return

        self._initialized = True
        self._config_path = Path(decky.DECKY_PLUGIN_DIR) / "config.json"
        self._config: dict[str, object] = {}
        self._load()

    def _load(self) -> None:
        """读取配置文件，未找到则初始化为空"""
        try:
            self._config_path.parent.mkdir(parents=True, exist_ok=True)
            if self._config_path.exists():
                with open(self._config_path, encoding="utf-8") as f:
                    self._config = json.load(f)
            else:
                self._config = {}
                self.save()
        except Exception as e:
            decky.logger.error(f"加载配置失败: {e}")
            self._config = {}

    def reload(self) -> dict[str, object]:
        """重新读取配置"""
        self._load()
        return self._config

    def save(self) -> bool:
        """将内存中的配置写回文件"""
        try:
            with open(self._config_path, "w", encoding="utf-8") as f:
                json.dump(self._config, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            decky.logger.error(f"保存配置失败: {e}")
            return False

    def get(self, key: str, default: object | None = None) -> object | None:
        """获取指定配置项"""
        return self._config.get(key, default)

    def set(self, key: str, value: object) -> object:
        """直接覆盖配置项"""
        self._config[key] = value
        self.save()
        return value

    def merge_dict(self, key: str, value: Mapping[str, object]) -> dict[str, object]:
        """将字典合并到指定配置项"""
        existing = self._config.get(key, {})
        merged = {**existing, **dict(value)} if isinstance(existing, dict) else dict(value)
        self._config[key] = merged
        self.save()
        return merged

    def delete(self, key: str) -> bool:
        """删除指定配置项"""
        if key in self._config:
            del self._config[key]
            self.save()
            return True
        return False

    def clear_all(self) -> None:
        """清空所有配置并删除配置文件"""
        self._config = {}
        if self._config_path.exists():
            try:
                self._config_path.unlink()
            except Exception as e:
                decky.logger.warning(f"删除配置文件失败: {e}")
        self._config_path.parent.mkdir(parents=True, exist_ok=True)

    def get_frontend_settings(self) -> FrontendSettings:
        settings = self.get("frontend_settings", {})
        return settings if isinstance(settings, dict) else {}

    def update_frontend_settings(self, updates: FrontendSettings) -> FrontendSettings:
        merged = {**self.get_frontend_settings(), **(updates or {})}
        self.set("frontend_settings", merged)
        return merged

    def delete_frontend_settings(self) -> bool:
        return self.delete("frontend_settings")

    def get_qqmusic_credential(self) -> dict[str, object] | None:
        cred = self.get("qqmusic_credential")
        return cred if isinstance(cred, dict) else None

    def set_qqmusic_credential(self, credential: Mapping[str, object]) -> dict[str, object]:
        return self.merge_dict("qqmusic_credential", credential)

    def delete_qqmusic_credential(self) -> bool:
        return self.delete("qqmusic_credential")

    def get_netease_session(self) -> str | None:
        session = self.get("netease_session")
        return session if isinstance(session, str) and session else None

    def set_netease_session(self, session: str) -> str:
        self.set("netease_session", session)
        return session

    def delete_netease_session(self) -> bool:
        return self.delete("netease_session")

    def get_main_provider_id(self) -> str | None:
        provider_id = self.get("main_provider_id")
        return provider_id if isinstance(provider_id, str) else None

    def set_main_provider_id(self, provider_id: str) -> str:
        self.set("main_provider_id", provider_id)
        return provider_id

    def delete_main_provider_id(self) -> bool:
        return self.delete("main_provider_id")

    def get_fallback_provider_ids(self) -> list[str]:
        ids = self.get("fallback_provider_ids", [])
        return ids if isinstance(ids, list) else []

    def set_fallback_provider_ids(self, provider_ids: list[str]) -> list[str]:
        deduped = list(dict.fromkeys(pid for pid in provider_ids if isinstance(pid, str)))
        self.set("fallback_provider_ids", deduped)
        return deduped

    def delete_fallback_provider_ids(self) -> bool:
        return self.delete("fallback_provider_ids")
