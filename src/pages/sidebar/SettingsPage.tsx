import { FC, useCallback, useEffect, useState } from "react";
import { PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { toaster } from "@decky/api";
import { FaTrash, FaMusic } from "react-icons/fa";

import { getPluginVersion, getFrontendSettings } from "../../api";
import { useMountedRef } from "../../hooks/useMountedRef";
import { useProvider } from "../../hooks/useProvider";
import type { PreferredQuality } from "../../types";
import { BackButton } from "../../components/common";
import { QualitySelector, UpdateSection, AboutSection } from "../../components/settings";

interface SettingsPageProps {
  onBack: () => void;
  onClearAllData?: () => Promise<boolean>;
  onGoToProviderSettings: () => void;
}

export const SettingsPage: FC<SettingsPageProps> = ({
  onBack,
  onClearAllData,
  onGoToProviderSettings,
}) => {
  const mountedRef = useMountedRef();
  const { provider, loading: providerLoading } = useProvider();
  const [localVersion, setLocalVersion] = useState<string>("");
  const [preferredQuality, setPreferredQuality] = useState<PreferredQuality>("auto");
  const [clearing, setClearing] = useState(false);

  const loadLocalVersion = useCallback(async () => {
    try {
      const res = await getPluginVersion();
      if (!mountedRef.current) return;
      if (res.success && res.version) {
        setLocalVersion(res.version);
      }
    } catch {
      // ignore
    }
  }, [mountedRef]);

  const loadPreferredQuality = useCallback(async () => {
    try {
      const res = await getFrontendSettings();
      if (!mountedRef.current) return;
      const value = res.settings?.preferredQuality;
      if (value === "auto" || value === "high" || value === "balanced" || value === "compat") {
        setPreferredQuality(value);
      }
    } catch {
      // ignore
    }
  }, [mountedRef]);

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

  return (
    <>
      <PanelSection title="音源设置">
        <PanelSectionRow>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <FaMusic />
            <span>当前音源：{providerLoading ? "加载中..." : provider?.name || "未知"}</span>
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onGoToProviderSettings}>
            切换音源 / 账号管理
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <QualitySelector value={preferredQuality} onChange={setPreferredQuality} />

      <UpdateSection localVersion={localVersion} onVersionUpdate={setLocalVersion} />

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

      <AboutSection />

      <BackButton onClick={onBack} />
    </>
  );
};

SettingsPage.displayName = "SettingsPage";
