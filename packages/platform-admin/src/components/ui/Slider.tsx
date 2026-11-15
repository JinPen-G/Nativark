import { ConfigProvider } from "antd";
import { Slider as ArcSlider, type SliderProps, type SliderValue } from "@/registry/components/slider/slider";
import { ArcLocale } from "./ArcLocale";

/** Native Arc slider contract; do not disguise it as Ant's richer API. */
export function Slider<T extends SliderValue = number>(props: SliderProps<T>) {
  const { componentDisabled } = ConfigProvider.useConfig();
  return <ArcLocale><ArcSlider {...props} disabled={props.disabled ?? componentDisabled} /></ArcLocale>;
}
