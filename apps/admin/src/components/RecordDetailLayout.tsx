/** 原营运宿主只供给品牌/路由页头；记录详情布局来自公共单源。 */
import { RecordDetailLayout as PublicRecordDetailLayout, type RecordDetailLayoutProps } from "@rental-os/platform-admin/ui";
import { PageHeader } from "./PageHeader";
export { RecordFacts, type RecordFact } from "@rental-os/platform-admin/shell";
export function RecordDetailLayout(props: RecordDetailLayoutProps) {
  return <PublicRecordDetailLayout {...props} header={props.header === undefined
    ? (_combined, slots) => <PageHeader title={props.title} extra={slots.actions} navigation={slots.navigation} tools={slots.tools} />
    : props.header} />;
}
