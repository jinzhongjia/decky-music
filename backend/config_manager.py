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
        self._settings_path = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "settings.json"
        self._data_path = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "data.json"
        self._settings: dict[str, object] = {}
        self._data: dict[str, object] = {}
        self._load()

    def _load(self) -> None:
        """读取配置文件，未找到则初始化为空"""
        try:
            self._settings_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Load settings
            if self._settings_path.exists():
                with open(self._settings_path, encoding="utf-8") as f:
                    self._settings = json.load(f)
            else:
                self._settings = {}
                self._save_settings()

            # Load data (credentials etc)
            if self._data_path.exists():
                with open(self._data_path, encoding="utf-8") as f:
                    self._data = json.load(f)
            else:
                self._data = {}
                self._save_data()
                
        except Exception as e:
            decky.logger.error(f"加载配置失败: {e}")
            self._settings = {}
            self._data = {}

    def reload(self) -> dict[str, object]:
        """重新读取配置"""
        self._load()
        return {**self._settings, **self._data}

    def _save_settings(self) -> bool:
        try:
            with open(self._settings_path, "w", encoding="utf-8") as f:
                json.dump(self._settings, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            decky.logger.error(f"保存设置失败: {e}")
            return False

    def _save_data(self) -> bool:
        try:
            with open(self._data_path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            decky.logger.error(f"保存数据失败: {e}")
            return False

    def save(self) -> bool:
        """保存所有配置"""
        return self._save_settings() and self._save_data()

    def get_setting(self, key: str, default: object | None = None) -> object | None:
        return self._settings.get(key, default)

    def set_setting(self, key: str, value: object) -> object:
        self._settings[key] = value
        self._save_settings()
        return value

    def get_data(self, key: str, default: object | None = None) -> object | None:
        return self._data.get(key, default)

    def set_data(self, key: str, value: object) -> object:
        self._data[key] = value
        self._save_data()
        return value

    def merge_data_dict(self, key: str, value: Mapping[str, object]) -> dict[str, object]:
        existing = self._data.get(key, {})
        merged = {**existing, **dict(value)} if isinstance(existing, dict) else dict(value)
        self._data[key] = merged
        self._save_data()
        return merged

    def delete_setting(self, key: str) -> bool:
        if key in self._settings:
            del self._settings[key]
            self._save_settings()
            return True
        return False

    def delete_data(self, key: str) -> bool:
        if key in self._data:
            del self._data[key]
            self._save_data()
            return True
        return False

    def clear_all(self) -> None:
        """清空所有配置并删除配置文件"""
        self._settings = {}
        self._data = {}
        for path in [self._settings_path, self._data_path]:
            if path.exists():
                try:
                    path.unlink()
                except Exception as e:
                    decky.logger.warning(f"删除配置文件失败 {path}: {e}")
        self._settings_path.parent.mkdir(parents=True, exist_ok=True)

    def get_frontend_settings(self) -> FrontendSettings:
        settings = self.get_setting("frontend_settings", {})
        # 强制转换为 FrontendSettings，实际运行时依赖字典结构兼容
        return settings if isinstance(settings, dict) else {}  # type: ignore

    def update_frontend_settings(self, updates: FrontendSettings) -> FrontendSettings:
        current = self.get_frontend_settings()
        merged = {**current, **(updates or {})}  # type: ignore
        self.set_setting("frontend_settings", merged)
        return merged  # type: ignore

    def delete_frontend_settings(self) -> bool:
        return self.delete_setting("frontend_settings")

    def get_qqmusic_credential(self) -> dict[str, object] | None:
        cred = self.get_data("qqmusic_credential")
        return cred if isinstance(cred, dict) else None

    def set_qqmusic_credential(self, credential: Mapping[str, object]) -> dict[str, object]:
        return self.merge_data_dict("qqmusic_credential", credential)

    def delete_qqmusic_credential(self) -> bool:
        return self.delete_data("qqmusic_credential")

    def get_netease_session(self) -> str | None:
        session = self.get_data("netease_session")
        return session if isinstance(session, str) and session else None

    def set_netease_session(self, session: str) -> str:
        self.set_data("netease_session", session)
        return session

    def delete_netease_session(self) -> bool:
        return self.delete_data("netease_session")

    def get_spotify_credential(self) -> dict[str, object] | None:
        """获取 Spotify 凭证"""
        cred = self.get_data("spotify_credential")
        return cred if isinstance(cred, dict) else None

    def set_spotify_credential(self, credential: Mapping[str, object]) -> dict[str, object]:
        """保存 Spotify 凭证"""
        return self.merge_data_dict("spotify_credential", credential)

    def delete_spotify_credential(self) -> bool:
        """删除 Spotify 凭证"""
        return self.delete_data("spotify_credential")

    def get_main_provider_id(self) -> str | None:
        provider_id = self.get_setting("main_provider_id")
        return provider_id if isinstance(provider_id, str) else None

    def set_main_provider_id(self, provider_id: str) -> str:
        self.set_setting("main_provider_id", provider_id)
        return provider_id

    def delete_main_provider_id(self) -> bool:
        return self.delete_setting("main_provider_id")

    def get_fallback_provider_ids(self) -> list[str]:
        ids = self.get_setting("fallback_provider_ids", [])
        return ids if isinstance(ids, list) else []

    def set_fallback_provider_ids(self, provider_ids: list[str]) -> list[str]:
        deduped = list(dict.fromkeys(pid for pid in provider_ids if isinstance(pid, str)))
        self.set_setting("fallback_provider_ids", deduped)
        return deduped

    def delete_fallback_provider_ids(self) -> bool:
        return self.delete_setting("fallback_provider_ids")
