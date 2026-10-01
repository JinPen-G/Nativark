import { ConfigProvider, Button as AntButton, type ButtonProps } from "antd";
import { forwardRef, useEffect, useState, type ComponentProps } from "react";
import { Button as ArcButton } from "@/registry/components/button/button";

/** Business-prop adapter only. Arc owns the button DOM, CSS, press and label motion. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { componentDisabled, componentSize } = ConfigProvider.useConfig();
  const { type = "default", htmlType = "button", icon, iconPlacement, iconPosition, children,
    size = componentSize, loading, disabled = componentDisabled, danger, block, shape,
    className, rootClassName, style, styles, classNames, ghost, color, variant, href,
    autoInsertSpace: _autoSpace, ...native } = props;
  const delay = typeof loading === "object" ? loading.delay ?? 0 : 0;
  const loadingEnabled = Boolean(loading);
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    setDelayed(false);
    if (!loadingEnabled || !delay) return;
    const timer = window.setTimeout(() => setDelayed(true), delay);
    return () => window.clearTimeout(timer);
  }, [loadingEnabled, delay]);
  // Retain genuine link semantics and uncommon semantic-slot overrides, rather than silently dropping them.
  if (href || styles || classNames || color && color !== "primary" && color !== "default" && color !== "danger") {
    return <AntButton {...props} ref={ref} />;
  }
  const busy = Boolean(loading) && (!delay || delayed);
  const arcVariant = danger || color === "danger" ? "danger"
    : type === "primary" || color === "primary" || variant === "solid" ? "primary"
    : type === "text" || type === "link" || ghost || variant === "text" || variant === "link" ? "ghost" : "secondary";
  const placement = iconPlacement ?? iconPosition ?? "start";
  return <ArcButton
    {...native as ComponentProps<typeof ArcButton>}
    ref={ref}
    type={htmlType}
    variant={arcVariant}
    size={size === "small" ? "sm" : size === "large" ? "lg" : "md"}
    disabled={disabled}
    loading={busy}
    data-rental-arc-button=""
    data-button-kind={type}
    data-button-danger={danger || color === "danger" || undefined}
    className={[className, rootClassName].filter(Boolean).join(" ")}
    style={{ ...(block ? { width: "100%" } : {}), ...(shape === "circle" ? { borderRadius: "50%", aspectRatio: "1", paddingInline: 0 } : {}), ...(shape === "round" ? { borderRadius: "var(--radius-pill)" } : {}), ...(type === "dashed" ? { borderStyle: "dashed" } : {}), ...style }}
  >{placement === "start" && icon}{children}{placement === "end" && icon}</ArcButton>;
});

export type { ButtonProps };
