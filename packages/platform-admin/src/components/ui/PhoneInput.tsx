import { ConfigProvider } from "antd";
import { PhoneInput as ArcPhoneInput, type PhoneInputProps } from "@/registry/components/phone-input/phone-input";
import { ArcLocale } from "./ArcLocale";

/** The original country picker, formatting and E.164 validation; no transport side effects. */
export function PhoneInput(props: PhoneInputProps) {
  const { componentDisabled } = ConfigProvider.useConfig();
  return <span className="arc-form-field arc-phone-field"><ArcLocale><ArcPhoneInput defaultCountry="CN" preferredCountries={["CN", "HK", "TW", "SG"]} {...props} disabled={props.disabled ?? componentDisabled} /></ArcLocale></span>;
}
