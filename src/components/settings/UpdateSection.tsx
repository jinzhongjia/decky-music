import { FC, useCallback, useMemo, useState } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Navigation } from "@decky/ui";
import { toaster } from "@decky/api";
import { FaDownload, FaSyncAlt } from "react-icons/fa";

import { checkUpdate, downloadUpdate } from "../../api";
import { useMountedRef } from "../../hooks/useMountedRef";
import type { UpdateInfo } from "../../types";

interface UpdateSectionProps {
  localVersion: string;
  onVersionUpdate: (version: string) => void;
}

export const UpdateSection: FC<UpdateSectionProps> = ({ localVersion, onVersionUpdate }) => {
  const mountedRef = useMountedRef();
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadPath, setDownloadPath] = useState<string | null>(null);

  const handleCheckUpdate = useCallback(async () => {
    setChecking(true);
    setDownloadPath(null);
    try {
      const res = await checkUpdate();
      if (!mountedRef.current) return;
      setUpdateInfo(res);
      if (res.currentVersion) {
        onVersionUpdate(res.currentVersion);
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
  }, [mountedRef, onVersionUpdate]);

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
    <PanelSection title="版本信息">
      <PanelSectionRow>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div>当前版本：{currentVersion}</div>
          {updateInfo?.latestVersion && <div>最新版本：{updateInfo.latestVersion}</div>}
          <div>状态：{checking ? "检查中..." : updateStatus}</div>
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={handleCheckUpdate} disabled={checking}>
          <FaSyncAlt
            style={{
              marginRight: 8,
              animation: checking ? "spin 1s linear infinite" : "none",
            }}
          />
          {checking ? "检查中..." : "检查更新"}
        </ButtonItem>
      </PanelSectionRow>
      {updateInfo?.hasUpdate && updateInfo.downloadUrl && (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={handleDownload} disabled={downloading}>
            <FaDownload
              style={{
                marginRight: 8,
                animation: downloading ? "spin 1s linear infinite" : "none",
              }}
            />
            {downloading ? "下载中..." : `下载 ${updateInfo.assetName || "更新包"}`}
          </ButtonItem>
        </PanelSectionRow>
      )}
      {downloadPath && (
        <PanelSectionRow>
          <div style={{ fontSize: 12, lineHeight: "18px" }}>已保存到：{downloadPath}</div>
        </PanelSectionRow>
      )}
      {updateInfo?.releasePage && (
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => Navigation.NavigateToExternalWeb(updateInfo.releasePage!)}
          >
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
  );
};

UpdateSection.displayName = "UpdateSection";
