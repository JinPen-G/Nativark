/** Controls edit service-local wall time; subscriptionOperations alone resolves it to an instant. */
import dayjs, { type Dayjs } from "dayjs";

export const serviceDateField = {
  getValueProps: (value?: string) => ({ value: value ? dayjs(value) : null }),
  getValueFromEvent: (value: Dayjs | null) => value?.format(value.millisecond() ? "YYYY-MM-DDTHH:mm:ss.SSS" : "YYYY-MM-DDTHH:mm:ss"),
};
