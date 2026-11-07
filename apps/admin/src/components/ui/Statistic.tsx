import { Statistic as AntStatistic, type StatisticProps } from "antd";
import { AnimatedCountText, AnimatedNumber } from "./AnimatedNumber";

export function Statistic(props: StatisticProps) {
  const numeric = typeof props.value === "number" && Number.isFinite(props.value);
  const formatter = props.formatter;
  return <AntStatistic {...props} formatter={numeric && (formatter === undefined || typeof formatter === "function") ? value => {
    if (!formatter) return <AnimatedNumber value={Number(value)} decimals={props.precision ?? 0} />;
    const formatted = formatter(value);
    return typeof formatted === "string" ? <AnimatedCountText text={formatted} /> : formatted;
  } : formatter} />;
}
