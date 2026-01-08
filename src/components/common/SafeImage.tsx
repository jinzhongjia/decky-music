import React, { FC, CSSProperties, memo, useCallback } from "react";
import { getDefaultCover } from "../../utils/format";

type SafeImageProps = {
  src?: string;
  alt: string;
  size: number;
  style?: CSSProperties;
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "style">;

const failedImages = new Set<string>();

const SafeImageComponent: FC<SafeImageProps> = ({
  src,
  alt,
  size,
  style,
  ...otherProps
}) => {
  const defaultCover = getDefaultCover(size);
  const isFailed = src && failedImages.has(src);
  const finalSrc = (src && !isFailed) ? src : defaultCover;

  const handleError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.target as HTMLImageElement;

    if (src && src !== defaultCover) {
      failedImages.add(src);
    }

    if (target.src !== defaultCover) {
      target.src = defaultCover;
    }
  }, [src, defaultCover]);

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

export const SafeImage = memo(SafeImageComponent);
