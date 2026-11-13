import { useState, type ImgHTMLAttributes } from "react";

// 图片默认可见，失败按原 src 显示占位。切换商品会重新尝试新图片。
interface ImgProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
}

export function Img({ src, alt, className, loading, ...rest }: ImgProps) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const broken = brokenSrc === src;
  const cls = [broken ? "img-broken" : "", className].filter(Boolean).join(" ");
  return (
    <img
      {...rest}
      src={broken || !src ? "/media/image-unavailable.svg" : src}
      alt={alt}
      className={cls}
      loading={loading ?? "lazy"}
      decoding="async"
      onError={() => {
        if (!broken) setBrokenSrc(src);
      }}
    />
  );
}
