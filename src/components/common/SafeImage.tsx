import React, { FC, CSSProperties, memo, useCallback } from "react";
import { getDefaultCover } from "../../utils/format";
import { addToBoundedSet } from "../../utils/boundedSet";

type SafeImageProps = {
  src?: string;
  alt: string;
  size: number;
  style?: CSSProperties;
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "style">;

const failedImages = new Set<string>();
const MAX_FAILED_IMAGE_CACHE_SIZE = 1000;

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
      addToBoundedSet(failedImages, src, MAX_FAILED_IMAGE_CACHE_SIZE);
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
      loading="lazy"
      onError={handleError}
      {...otherProps}
    />
  );
};

export const SafeImage = memo(SafeImageComponent);
