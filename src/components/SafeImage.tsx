/**
 * 安全图片组件
 * 封装图片加载和错误处理逻辑，自动使用默认封面替换失败的图片
 */

import React, { FC, CSSProperties } from "react";
import { getDefaultCover } from "../utils/format";

type SafeImageProps = {
  /** 图片源地址 */
  src?: string;
  /** 图片描述 */
  alt: string;
  /** 图片尺寸（用于生成默认封面） */
  size: number;
  /** 自定义样式 */
  style?: CSSProperties;
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "style">;

const failedImages = new Set<string>();

export const SafeImage: FC<SafeImageProps> = ({
  src,
  alt,
  size,
  style,
  ...otherProps
}) => {
  const defaultCover = getDefaultCover(size);
  // 如果已知该图片链接无效，直接使用默认封面
  const isFailed = src && failedImages.has(src);
  const finalSrc = (src && !isFailed) ? src : defaultCover;

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.target as HTMLImageElement;

    // 记录失败的 URL
    if (src && src !== defaultCover) {
      failedImages.add(src);
    }

    // 避免无限循环：如果已经是默认封面，就不再替换
    if (target.src !== defaultCover) {
      target.src = defaultCover;
    }
  };

  return (
    <img
      src={finalSrc}
      alt={alt}
      style={style}
      onError={handleError}
      {...otherProps}
    />
  );
};
