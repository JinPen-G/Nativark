// Preserve the reference badge geometry in both hero and scrolled-header variants.
const chipSurface = {
  background:
    "linear-gradient(135deg, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.08) 35%, rgba(255,255,255,0.04) 65%, rgba(255,255,255,0.5) 100%)",
  boxShadow: "0 0 16px rgba(255,255,255,0.08), 0 0 32px rgba(255,255,255,0.04)",
};
const chipSizes = {
  sm: "px-[9px] pt-[4px] pb-[3px] text-[11px]",
  md: "px-[11px] pt-[5px] pb-[4px] text-[12px]",
};
export function PreviewBadge({
  variant = "chip",
  size = "sm",
  label,
  children,
}) {
  return (
    <span
      aria-label={label}
      title={label}
      style={variant === "micro" ? undefined : chipSurface}
      className={
        variant === "micro"
          ? "inline-flex items-center gap-[7px] font-mono text-[12px] font-medium uppercase leading-none tracking-[0.22em] text-white/45"
          : "inline-flex items-center rounded-[8px] p-[1px] min-w-0 max-w-full"
      }
    >
      {variant === "micro" && (
        <svg
          viewBox="0 0 24 24"
          className="h-3 w-3 shrink-0 -translate-y-[1.5px]"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="harness-badge-sparkle"
              x1="2"
              y1="22"
              x2="22"
              y2="2"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#D2E0FF" stopOpacity="0.6" />
              <stop offset="1" stopColor="#A6C2FF" stopOpacity="0.38" />
            </linearGradient>
          </defs>
          <path
            d="M9 6C10.53 9.82 13.68 12.97 17.5 14.5C13.68 16.03 10.53 19.18 9 23C7.47 19.18 4.32 16.03 0.5 14.5C4.32 12.97 7.47 9.82 9 6Z"
            fill="url(#harness-badge-sparkle)"
          />
          <path
            d="M19.5 1C20.22 2.8 21.7 4.28 23.5 5C21.7 5.72 20.22 7.2 19.5 9C18.78 7.2 17.3 5.72 15.5 5C17.3 4.28 18.78 2.8 19.5 1Z"
            fill="url(#harness-badge-sparkle)"
          />
        </svg>
      )}
      {variant === "micro" ? (
        children
      ) : (
        <span
          className={
            "min-w-0 truncate rounded-[7px] font-mono font-medium leading-none bg-black/25 text-white/95 " +
            chipSizes[size]
          }
        >
          {children}
        </span>
      )}
    </span>
  );
}
