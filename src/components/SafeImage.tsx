/**
 * 安全图片组件
 * 封装图片加载和错误处理逻辑，自动使用默认封面替换失败的图片
 */

import { FC, CSSProperties } from "react";
import { getDefaultCover } from "../utils/format";

interface SafeImageProps {
  /** 图片源地址 */
  src?: string;
  /** 图片描述 */
  alt: string;
  /** 图片尺寸（用于生成默认封面） */
  size: number;
  /** 自定义样式 */
  style?: CSSProperties;
  /** 其他 img 标签属性 */
  [key: string]: any;
}

export const SafeImage: FC<SafeImageProps> = ({ 
  src, 
  alt, 
  size,
  style,
  ...otherProps 
}) => {
  const defaultCover = getDefaultCover(size);
  
  const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const target = e.target as HTMLImageElement;
    // 避免无限循环：如果已经是默认封面，就不再替换
    if (target.src !== defaultCover) {
      target.src = defaultCover;
    }
  };

  return (
    <img 
      src={src || defaultCover}
      alt={alt}
      style={style}
      onError={handleError}
      {...otherProps}
    />
  );
};

