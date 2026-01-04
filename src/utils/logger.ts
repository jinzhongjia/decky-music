/**
 * 前端日志工具
 * 将前端日志输出到后端日志系统，方便调试和问题排查
 */

import { logFromFrontend } from "../api";

type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * 发送日志到后端
 */
async function sendLog(level: LogLevel, message: string, data?: Record<string, unknown>): Promise<void> {
  try {
    await logFromFrontend(level, message, data);
  } catch {
    // 忽略日志发送失败，避免影响主流程
  }
}

/**
 * 前端日志工具
 * 替代 console.log/warn/error，将日志发送到后端
 */
export const logger = {
  /**
   * 信息日志
   */
  info: (message: string, data?: Record<string, unknown>) => {
    void sendLog("info", message, data);
  },

  /**
   * 警告日志
   */
  warn: (message: string, data?: Record<string, unknown>) => {
    void sendLog("warn", message, data);
  },

  /**
   * 错误日志
   */
  error: (message: string, data?: Record<string, unknown>) => {
    void sendLog("error", message, data);
  },

  /**
   * 调试日志
   */
  debug: (message: string, data?: Record<string, unknown>) => {
    void sendLog("debug", message, data);
  },
};

