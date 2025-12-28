import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Spinner, Navigation } from "@decky/ui";
import { toaster } from "@decky/api";
import { FaDownload, FaExternalLinkAlt, FaInfoCircle, FaSyncAlt } from "react-icons/fa";

import { checkUpdate, downloadUpdate, getPluginVersion } from "../api";
import { useMountedRef } from "../hooks/useMountedRef";
import type { UpdateInfo } from "../types";
import { BackButton } from "./BackButton";

interface SettingsPageProps {
  onBack: () => void;
}

const REPO_URL = "https://github.com/jinzhongjia/decky-qqmusic";

export const SettingsPage: FC<SettingsPageProps> = ({ onBack }) => {
  const mountedRef = useMountedRef();
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState<string>("");

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

  useEffect(() => {
    void loadLocalVersion();
  }, [loadLocalVersion]);

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
