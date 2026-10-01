import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { Form, FormSection, Input, Button, Switch } from "../../apps/admin/src/components/ui";
function Harness() {
  const [form]=Form.useForm();
  const [calls,setCalls]=useState(0),[disabled,setDisabled]=useState(false);
  return <ConfigProvider><Form form={form} layout="vertical" disabled={disabled} onFinish={()=>setCalls(n=>n+1)}>
    <FormSection title="Basic information" description="Unified field presentation">
      <Form.Item name="name" label="Customer name" extra="Name on the agreement" rules={[{required:true,message:"Enter customer name"}]}><Input /></Form.Item>
      <Form.Item name="confirm" label="Confirm name" dependencies={["name"]} rules={[({getFieldValue})=>({validator:(_,v)=>v===getFieldValue("name")?Promise.resolve():Promise.reject(new Error("Names must match"))})]}><Input /></Form.Item>
      <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="custom" label="Custom help" help="Preserve custom help" validateStatus="error"><Input /></Form.Item>
      <Form.Item noStyle name="hidden" initialValue="preserved"><input type="hidden" /></Form.Item>
      <Form.List name="addresses" initialValue={[{city:"Shanghai"}]}>{fields=>fields.map(f=><Form.Item key={f.key} name={[f.name,"city"]} label="City"><Input /></Form.Item>)}</Form.List>
    </FormSection><Button htmlType="submit">Submit fixture</Button>
    <Button onClick={()=>form.resetFields()}>Reset fixture</Button>
  </Form><button onClick={()=>setDisabled(v=>!v)}>Disable fixture</button><output id="form-calls">{calls}</output></ConfigProvider>;
}
document.querySelectorAll("#form-fixture").forEach(node=>node.remove());
const mount=document.createElement("section");mount.id="form-fixture";
mount.style.cssText="position:fixed;inset:0;z-index:500;overflow:auto;background:var(--background);padding:32px";
document.body.appendChild(mount);createRoot(mount).render(<Harness/>);
