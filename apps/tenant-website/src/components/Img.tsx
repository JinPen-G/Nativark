import { useCallback, useState, type ImgHTMLAttributes } from 'react';

// 统一图片淡入：父级预留 aspect-ratio 占位，图片加载完成后 opacity/scale 淡入；
// 失败回退灰底占位（复用 .img-broken）。reduced-motion 下由 CSS 去掉 scale/瞬显。
// 状态按 src 记录：同一 DOM 节点复用（如详情页相关商品 A→B 切换）src 变化时自动重置，
// 避免上一张的 broken/loaded 粘连（否则会让新图不可见或不淡入）。命中缓存由 ref 挂载时补判。
interface ImgProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
}

export function Img({ src, alt, className, loading, ...rest }: ImgProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;
  const broken = brokenSrc === src;
  const measure = useCallback((node: HTMLImageElement | null) => {
    if (node && node.complete && node.naturalWidth > 0) setLoadedSrc(node.getAttribute('src'));
  }, []);
  const cls = ['img-fade', loaded ? 'is-loaded' : '', broken ? 'img-broken' : '', className].filter(Boolean).join(' ');
  return <img
    {...rest}
    ref={measure}
    src={src}
    alt={alt}
    className={cls}
    loading={loading ?? 'lazy'}
    decoding="async"
    onLoad={() => setLoadedSrc(src)}
    onError={() => setBrokenSrc(src)}
  />;
}
