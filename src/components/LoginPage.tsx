/**
 * 登录页面组件
 */

import { FC, useState, useEffect, useRef } from "react";
import { PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { toaster } from "@decky/api";
import { FaQrcode } from "react-icons/fa";
import { getQrCode, checkQrStatus } from "../api";
import { LoadingSpinner } from "./LoadingSpinner";
import { FocusableList } from "./FocusableList";
import { useMountedRef } from "../hooks/useMountedRef";
import { useProvider, Capability } from "../providers";
import { COLORS } from "../utils/styles";

interface LoginPageProps {
  onLoginSuccess: () => void;
}

type LoginStatus =
  | "idle"
  | "loading"
  | "waiting"
  | "scanned"
  | "success"
  | "timeout"
  | "refused"
  | "error";

export const LoginPage: FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [qrData, setQrData] = useState<string>("");
  const [status, setStatus] = useState<LoginStatus>("idle");
  const [loginType, setLoginType] = useState<"qq" | "wx">("qq");
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useMountedRef();
  const { hasCapability, currentProvider } = useProvider();

  const canQqLogin = hasCapability(Capability.LOGIN_QR_CODE);
  const canWxLogin = hasCapability(Capability.LOGIN_QR_CODE_WECHAT);

  const fetchQrCode = async (type: "qq" | "wx") => {
    setLoginType(type);
    setStatus("loading");

    const result = await getQrCode(type);
    if (!mountedRef.current) return;

    if (result.success && result.qr_data) {
      setQrData(result.qr_data);
      setStatus("waiting");
      startCheckingStatus();
    } else {
      setStatus("error");
      toaster.toast({
        title: "获取二维码失败",
        body: result.error || "未知错误",
      });
    }
  };

  const startCheckingStatus = () => {
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
    }

    checkIntervalRef.current = setInterval(async () => {
      const result = await checkQrStatus();
      if (!mountedRef.current) return;

      if (result.success) {
        switch (result.status) {
          case "success":
            clearInterval(checkIntervalRef.current!);
            setStatus("success");
            toaster.toast({
              title: "登录成功",
              body: "欢迎回来！",
            });
            setTimeout(onLoginSuccess, 800);
            break;
          case "scanned":
            setStatus("scanned");
            break;
          case "timeout":
            clearInterval(checkIntervalRef.current!);
            setStatus("timeout");
            break;
          case "refused":
            clearInterval(checkIntervalRef.current!);
            setStatus("refused");
            break;
        }
      }
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, []);

  const getStatusText = () => {
    switch (status) {
      case "loading":
        return "正在获取二维码...";
      case "waiting":
        return "请使用手机扫描二维码";
      case "scanned":
        return "已扫描，请在手机上确认登录";
      case "success":
        return "✓ 登录成功！";
      case "timeout":
        return "二维码已过期，请刷新";
      case "refused":
        return "登录已取消";
      case "error":
        return "获取二维码失败";
      default:
        return "选择登录方式开始";
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case "success":
        return COLORS.primary;
      case "scanned":
        return "#ffc107";
      case "timeout":
      case "refused":
      case "error":
        return COLORS.error;
      default:
        return "#b8bcbf";
    }
  };

  const providerName = currentProvider?.name || "音乐";

  return (
    <PanelSection title={`🎵 ${providerName}登录`}>
      <PanelSectionRow>
        <div
          style={{
            textAlign: "center",
            padding: "10px",
            color: getStatusColor(),
            fontSize: "14px",
            fontWeight: status === "success" ? 600 : 400,
          }}
        >
          {getStatusText()}
        </div>
      </PanelSectionRow>

      {qrData && status !== "success" && (
        <PanelSectionRow>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "15px",
              background: COLORS.textPrimary,
              borderRadius: "12px",
              margin: "0 auto",
              width: "fit-content",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            <img
              src={qrData}
              alt="登录二维码"
              style={{
                width: "180px",
                height: "180px",
                imageRendering: "pixelated",
              }}
            />
          </div>
        </PanelSectionRow>
      )}

      {status === "loading" && <LoadingSpinner padding={20} />}

      {status === "idle" && (
        <PanelSectionRow>
          <FocusableList gap="10px">
            {canQqLogin && (
              <ButtonItem layout="below" onClick={() => fetchQrCode("qq")}>
                <FaQrcode style={{ marginRight: "8px" }} />
                QQ 扫码登录
              </ButtonItem>
            )}
            {canWxLogin && (
              <ButtonItem layout="below" onClick={() => fetchQrCode("wx")}>
                <FaQrcode style={{ marginRight: "8px" }} />
                微信扫码登录
              </ButtonItem>
            )}
          </FocusableList>
        </PanelSectionRow>
      )}

      {(status === "timeout" || status === "refused" || status === "error") && (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => fetchQrCode(loginType)}>
            🔄 刷新二维码
          </ButtonItem>
        </PanelSectionRow>
      )}

      {status !== "idle" && status !== "success" && (
        <PanelSectionRow>
          <div
            style={{
              textAlign: "center",
              fontSize: "12px",
              color: COLORS.textSecondary,
              marginTop: "10px",
            }}
          >
            当前登录方式：{loginType === "qq" ? "QQ" : "微信"}
          </div>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
};
