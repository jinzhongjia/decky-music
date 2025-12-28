import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Spinner, Navigation, Field } from "@decky/ui";
import { toaster } from "@decky/api";
import { FaDownload, FaExternalLinkAlt, FaInfoCircle, FaSyncAlt, FaTrash } from "react-icons/fa";

import { checkUpdate, downloadUpdate, getPluginVersion, getFrontendSettings, saveFrontendSettings } from "../api";
import { useMountedRef } from "../hooks/useMountedRef";
import { setPreferredQuality } from "../hooks/usePlayer";
import type { PreferredQuality, UpdateInfo } from "../types";
import { BackButton } from "./BackButton";

interface SettingsPageProps {
  onBack: () => void;
  onClearAllData?: () => Promise<boolean>;
}

const REPO_URL = "https://github.com/jinzhongjia/decky-qqmusic";
const QUALITY_OPTIONS: Array<{ value: PreferredQuality; label: string; desc: string }> = [
  { value: "auto", label: "自动（推荐）", desc: "优先高码率，若不可用自动降级" },
  { value: "high", label: "高音质优先", desc: "320kbps/192kbps 优先，可能需要会员，不可用时自动降级" },
  { value: "balanced", label: "均衡", desc: "192kbps / 128kbps 优先，兼顾质量与稳定性" },
  { value: "compat", label: "兼容/低延迟", desc: "128kbps 及以下优先，适合不稳定网络或节省流量" },
];

export const SettingsPage: FC<SettingsPageProps> = ({ onBack, onClearAllData }) => {
  const mountedRef = useMountedRef();
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState<string>("");
  const [preferredQuality, setPreferredQualityState] = useState<PreferredQuality>("auto");
  const [clearing, setClearing] = useState(false);

  const handleCheckUpdate = useCallback(async () => {
    setChecking(true);
    setDownloadPath(null);
    try {
      const res = await checkUpdate();
      if (!mountedRef.current) return;
      setUpdateInfo(res);
      if (res.currentVersion) {
        setLocalVersion(res.currentVersion);
      }
      if (!res.success) {
        toaster.toast({ title: "检查更新失败", body: res.error || "未知错误" });
      }
    } catch (e) {
      if (!mountedRef.current) return;
      toaster.toast({ title: "检查更新失败", body: (e as Error).message });
    } finally {
      if (mountedRef.current) {
        setChecking(false);
      }
    }
  }, [mountedRef]);

  const handleDownload = useCallback(async () => {
    if (!updateInfo?.downloadUrl) {
      toaster.toast({ title: "无法下载", body: "缺少下载链接" });
      return;
    }
    setDownloading(true);
    setDownloadPath(null);
    try {
      const res = await downloadUpdate(updateInfo.downloadUrl, updateInfo.assetName);
      if (!mountedRef.current) return;
      if (res.success) {
        setDownloadPath(res.path || null);
        toaster.toast({ title: "下载完成", body: res.path || "已保存到 ~/Download" });
      } else {
        toaster.toast({ title: "下载失败", body: res.error || "请稍后重试" });
      }
    } catch (e) {
      if (!mountedRef.current) return;
      toaster.toast({ title: "下载失败", body: (e as Error).message });
    } finally {
      if (mountedRef.current) {
        setDownloading(false);
      }
    }
  }, [mountedRef, updateInfo]);

  const handleOpenRepo = useCallback(() => {
    Navigation.CloseSideMenus?.();
    Navigation.NavigateToExternalWeb(REPO_URL);
  }, []);

  const loadLocalVersion = useCallback(async () => {
    try {
      const res = await getPluginVersion();
      if (!mountedRef.current) return;
      if (res.success && res.version) {
        setLocalVersion(res.version);
      }
    } catch {
      // 忽略
    }
  }, [mountedRef]);

  const loadPreferredQuality = useCallback(async () => {
    try {
      const res = await getFrontendSettings();
      if (!mountedRef.current) return;
      const value = res.settings?.preferredQuality;
      if (value === "auto" || value === "high" || value === "balanced" || value === "compat") {
        setPreferredQualityState(value);
      }
    } catch {
      // ignore
    }
  }, [mountedRef]);

  const handleQualityChange = useCallback(
    async (value: PreferredQuality) => {
      setPreferredQualityState(value);
      setPreferredQuality(value);
      try {
        await saveFrontendSettings({ preferredQuality: value });
        toaster.toast({ title: "音质偏好已更新", body: QUALITY_OPTIONS.find((o) => o.value === value)?.label });
      } catch (e) {
        toaster.toast({ title: "保存失败", body: (e as Error).message });
      }
    },
    []
  );

  const handleClearData = useCallback(async () => {
    if (clearing) return;
    setClearing(true);
    try {
      const success = await (onClearAllData ? onClearAllData() : Promise.resolve(false));
      if (!mountedRef.current) return;
      toaster.toast({
        title: success ? "已清除数据" : "清除失败",
        body: success ? "请重新登录" : "未知错误",
      });
    } catch (e) {
      if (!mountedRef.current) return;
      toaster.toast({ title: "清除失败", body: (e as Error).message });
    } finally {
      if (mountedRef.current) {
        setClearing(false);
      }
    }
  }, [clearing, mountedRef, onClearAllData]);

  useEffect(() => {
    void loadLocalVersion();
    void loadPreferredQuality();
  }, [loadLocalVersion, loadPreferredQuality]);

  const updateStatus = useMemo(() => {
    if (!updateInfo) return "尚未检查";
    if (!updateInfo.success) return "检查失败";
    if (updateInfo.hasUpdate) return "发现新版本";
    return "已是最新";
  }, [updateInfo]);

  const currentVersion = useMemo(() => {
    if (localVersion) return `v${localVersion}`;
    if (updateInfo?.currentVersion) return `v${updateInfo.currentVersion}`;
    return "未知";
  }, [localVersion, updateInfo]);

  return (
    <>
      <PanelSection title="音质偏好">
        <PanelSectionRow>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              width: "100%",
              maxWidth: 480,
              margin: "0 auto",
            }}
          >
            {QUALITY_OPTIONS.map((option) => {
              const active = preferredQuality === option.value;
              return (
                <Field
                  key={option.value}
                  focusable
                  highlightOnFocus
                  focusClassName="qqmusic-control-btn-focused"
                  bottomSeparator="none"
                  onActivate={() => handleQualityChange(option.value)}
                  onClick={() => handleQualityChange(option.value)}
                  padding="none"
                  label={
                    <div
                      style={{
                        width: "100%",
                        padding: "12px 14px",
                        borderRadius: 14,
                        border: active ? "2px solid #1DB954" : "1px solid rgba(255,255,255,0.12)",
                        background: active ? "rgba(29,185,84,0.16)" : "rgba(255,255,255,0.05)",
                        color: "inherit",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        boxShadow: "none",
                      }}
                    >
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          border: "2px solid #1DB954",
                          background: active ? "#1DB954" : "transparent",
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{option.label}</div>
                        <div style={{ fontSize: 12, opacity: 0.9, lineHeight: "18px" }}>{option.desc}</div>
                      </div>
                    </div>
                  }
                />
              );
            })}
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="版本信息">
        <PanelSectionRow>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div>当前版本：{currentVersion}</div>
            {updateInfo?.latestVersion && (
              <div>最新版本：{updateInfo.latestVersion}</div>
            )}
            <div>状态：{checking ? "检查中..." : updateStatus}</div>
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={handleCheckUpdate} disabled={checking}>
            <FaSyncAlt style={{ marginRight: 8 }} />
            {checking ? "检查中..." : "检查更新"}
          </ButtonItem>
        </PanelSectionRow>
        {checking && (
          <PanelSectionRow>
            <Spinner />
          </PanelSectionRow>
        )}
        {updateInfo?.hasUpdate && updateInfo.downloadUrl && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={handleDownload} disabled={downloading}>
              <FaDownload style={{ marginRight: 8 }} />
              {downloading ? "下载中..." : `下载 ${updateInfo.assetName || "更新包"}`}
            </ButtonItem>
          </PanelSectionRow>
        )}
        {downloading && (
          <PanelSectionRow>
            <Spinner />
          </PanelSectionRow>
        )}
        {downloadPath && (
          <PanelSectionRow>
            <div style={{ fontSize: 12, lineHeight: "18px" }}>
              已保存到：{downloadPath}
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>

      <PanelSection title="数据管理">
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={handleClearData} disabled={clearing}>
            <FaTrash style={{ marginRight: 8 }} />
            {clearing ? "清除中..." : "清除所有数据"}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: 12, lineHeight: "18px", opacity: 0.9 }}>
            将清除登录凭证和前端设置，操作不可撤销。
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="项目说明">
        <PanelSectionRow>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <FaInfoCircle style={{ marginTop: 4 }} />
            <div style={{ lineHeight: "18px" }}>
              Decky QQ Music 插件，提供扫码登录、音乐播放、歌词与歌单等功能。感谢使用并欢迎反馈。
            </div>
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={handleOpenRepo}>
            <FaExternalLinkAlt style={{ marginRight: 8 }} />
            项目地址
          </ButtonItem>
        </PanelSectionRow>
        {updateInfo?.releasePage && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => Navigation.NavigateToExternalWeb(updateInfo.releasePage!)}>
              <FaExternalLinkAlt style={{ marginRight: 8 }} />
              打开最新 Release
            </ButtonItem>
          </PanelSectionRow>
        )}
        {updateInfo?.notes && (
          <PanelSectionRow>
            <div
              style={{
                whiteSpace: "pre-wrap",
                fontSize: 12,
                lineHeight: "18px",
                opacity: 0.9,
              }}
            >
              {updateInfo.notes}
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>

      <BackButton onClick={onBack} />
    </>
  );
};

SettingsPage.displayName = "SettingsPage";
