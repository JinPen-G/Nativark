"use client";
import { assetPath } from "../../lib/site";
export const EASE_IN_OUT = [0.44, 0, 0.56, 1];
export function Button({
  as: Tag = "button",
  variant = "primary",
  size = "m",
  icon,
  className,
  children,
  ...props
}) {
  return (
    <Tag
      className={["ds-btn-" + variant, "ds-btn-" + size, className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {icon}
      {children}
    </Tag>
  );
}
function Icon({ size = 24, children, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}
// Export names match the migrated header's two original icon bindings.
export function CloseIcon(props) {
  return (
    <Icon {...props}>
      <path
        d="M3 6h18M3 12h18M3 18h18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Icon>
  );
}
export function MenuIcon(props) {
  return (
    <Icon {...props}>
      <path
        d="M6 6l12 12M6 18L18 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Icon>
  );
}
export function ChevronDown({ size = 16, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}
export function DocumentIcon(props) {
  return (
    <Icon size={16} {...props}>
      <path
        d="M6 3h9l3 3v15H6ZM9 10h6M9 14h6"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </Icon>
  );
}
export function BrandLogo({ className }) {
  return (
    <img
      className={className}
      src={assetPath("/icons/rentalos-logo.svg")}
      alt="Rental OS"
      height={24}
    />
  );
}
