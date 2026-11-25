import { forwardRef, type ImgHTMLAttributes } from 'react';
type Props = ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean };
export const ReferenceImage = forwardRef<HTMLImageElement, Props>(function ReferenceImage({ fill, priority, style, src, alt = '', ...props }, ref) {
  return <img {...props} src={src} alt={alt} ref={ref} decoding="async" fetchPriority={priority ? 'high' : props.fetchPriority} style={fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', ...style } : style} />;
});
