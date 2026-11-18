import type { ImgHTMLAttributes } from 'react';
export interface SourceImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  fill?: boolean;
  priority?: boolean;
}
/** Keeps the preview's ordinary image attributes for reusable photo data. */
export function getImageProps(
  props: ImgHTMLAttributes<HTMLImageElement> & { src: string },
) {
  return {
    props: {
      ...props,
      style: { color: 'transparent', ...props.style },
    },
  };
}
/** Gives regular browser images the original preview's fill geometry. */
export function SourceImage({
  fill,
  priority,
  style,
  loading,
  ...props
}: SourceImageProps) {
  return (
    <img
      {...props}
      loading={priority ? 'eager' : loading}
      style={{
        ...(fill
          ? { position: 'absolute', width: '100%', height: '100%', inset: 0 }
          : {}),
        ...style,
      }}
    />
  );
}
