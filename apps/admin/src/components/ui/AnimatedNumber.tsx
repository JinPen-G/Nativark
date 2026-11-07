import { AnimatedCounter } from "@/registry/components/animated-counter/animated-counter";
import { useLocale } from "@/app/locale";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

export function AnimatedNumber({ value, decimals = 0, prefix, suffix }: { value: number; decimals?: number; prefix?: string; suffix?: string }) {
  const { locale } = useLocale();
  const reduced = usePrefersReducedMotion();
  if (!Number.isFinite(value)) return <>—</>;
  return <span className="rental-animated-number">{reduced
    ? `${prefix ?? ""}${new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)}${suffix ?? ""}`
    : <AnimatedCounter value={value} decimals={decimals} prefix={prefix} suffix={suffix} locale={locale} />}</span>;
}

export function AnimatedCountText({ text }: { text: string }) {
  return <>{text.split(/(-?\d[\d,]*(?:\.\d+)?)/u).map((part, index) => /^-?\d/u.test(part)
    ? <AnimatedNumber key={index} value={Number(part.replaceAll(",", ""))} decimals={part.includes(".") ? part.split(".")[1].length : 0} /> : part)}</>;
}
