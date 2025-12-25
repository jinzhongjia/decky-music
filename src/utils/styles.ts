/**
 * 样式常量
 * 统一管理常用的样式定义，便于主题切换和性能优化
 */

import { CSSProperties } from "react";

// ==================== 文本样式 ====================

/** 文本溢出省略样式 */
export const TEXT_ELLIPSIS: CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** 文本溢出省略（多行，最多2行） */
export const TEXT_ELLIPSIS_2_LINES: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
};

// ==================== 布局样式 ====================

/** 居中布局 */
export const FLEX_CENTER: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
};

/** 居中布局（仅水平） */
export const FLEX_CENTER_HORIZONTAL: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
};

// ==================== 颜色常量 ====================

export const COLORS = {
  /** 主色调（绿色） */
  primary: '#1db954',
  /** 主色调（亮绿色） */
  primaryLight: '#1ed760',
  /** 主色调（半透明背景） */
  primaryBg: 'rgba(29, 185, 84, 0.15)',
  /** 主色调（阴影） */
  primaryShadow: 'rgba(29, 185, 84, 0.4)',
  
  /** 主要文本颜色 */
  textPrimary: '#fff',
  /** 次要文本颜色 */
  textSecondary: '#8b929a',
  
  /** 浅色背景 */
  backgroundLight: 'rgba(255,255,255,0.03)',
  /** 中等背景 */
  backgroundMedium: 'rgba(255,255,255,0.05)',
  /** 较深背景 */
  backgroundDark: 'rgba(255,255,255,0.1)',
  /** 深色背景 */
  backgroundDarker: 'rgba(255,255,255,0.15)',
  /** 深色基础背景 */
  backgroundDarkBase: '#2a2a2a',
  
  /** 浅色边框 */
  borderLight: 'rgba(255,255,255,0.1)',
  
  /** 错误颜色 */
  error: '#ff6b6b',
  /** 错误背景 */
  errorBg: 'rgba(255, 107, 107, 0.1)',
  
  /** 透明 */
  transparent: 'transparent',
} as const;

// ==================== 常用组合样式 ====================

/** 文本容器（带溢出处理） */
export const TEXT_CONTAINER: CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  minWidth: 0,
};

/** 文本容器（带溢出处理和省略） */
export const TEXT_CONTAINER_ELLIPSIS: CSSProperties = {
  ...TEXT_CONTAINER,
  ...TEXT_ELLIPSIS,
};

