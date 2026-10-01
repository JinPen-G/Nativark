import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider, Form, Select, Modal } from "antd";
import { ActionButton, SaveButton, CopyButton, Button, ConfirmAction, Drawer, Dropdown, Input, Segmented, Switch, Tabs } from "../../apps/admin/src/components/ui";
import { LocaleProvider } from "../../apps/admin/src/app/locale";
import { applyArcThemeTokens } from "../../apps/admin/src/app/arcTokens";
import { applyAdminRadiusTokens } from "../../apps/admin/src/app/designTokens";
import { Alert, ColorPicker, DatePicker, Pagination, Progress, RichTextEditor, Steps, Table, Upload } from "../../apps/admin/src/components/ui";
import { CLIENT_RICH_TEXT_PREFIX, parseClientRichText } from "../../packages/shared/src/client-rich-text";
import dayjs from "dayjs";

function Harness() {
  const [open, setOpen] = useState(false), [nested, setNested] = useState(false);
  const [modal, setModal] = useState(false), [fail, setFail] = useState(true);
  const [result, setResult] = useState(""), [tab, setTab] = useState("first");
  const [dark, setDark] = useState(false), [calls, setCalls] = useState(0);
  const [saveForm] = Form.useForm();
  const [date, setDate] = useState(dayjs("2026-10-01T09:37:42"));
  const [range, setRange] = useState<any>(null), [color,setColor]=useState("#ce0000"), [body,setBody]=useState("Legacy plain text\nSecond line");
  const [files,setFiles]=useState<any[]>([]),[uploadCalls,setUploadCalls]=useState(0),[page,setPage]=useState(1),[step,setStep]=useState(0);
  const [optionalRange,setOptionalRange]=useState<any>(null);
  return <ConfigProvider><App><LocaleProvider><main id="arc-test" style={{padding:32,background:"var(--background)",color:"var(--foreground)"}}>
    <h1>Arc adapter acceptance</h1>
    <section id="extended-fixtures">
      <Alert type="info" title="Animated notice" description="Original Arc alert" closable />
      <DatePicker value={date} showTime onChange={next=>setDate(next as any)} disabledDate={day=>day.isBefore("2026-10-01","day")} /><output id="date-value">{date?.format("YYYY-MM-DD HH:mm:ss")}</output>
      <DatePicker.RangePicker value={range} showTime onChange={setRange}/><output id="range-value">{JSON.stringify(range?.map((d:any)=>d?.format("YYYY-MM-DD HH:mm:ss")))}</output>
      <div id="optional-range"><DatePicker.RangePicker value={optionalRange} allowEmpty={[false,true]} onChange={setOptionalRange}/><output id="optional-value">{JSON.stringify(optionalRange?.map((d:any)=>d?.format("YYYY-MM-DD")))}</output></div>
      <ColorPicker value={color} onChange={setColor}/><output id="color-value">{color}</output>
      <RichTextEditor value={body} onChange={setBody}/><output id="body-value">{body}</output>
      <Button onClick={()=>setBody(CLIENT_RICH_TEXT_PREFIX+JSON.stringify([{type:"node",name:"script",attrs:{onclick:"x"},children:[{type:"text",text:"window.__bad=1"}]},{type:"node",name:"a",attrs:{href:"javascript:alert(1)",onclick:"x"},children:[{type:"text",text:"Safe link"}]}]))}>Unsafe document fixture</Button>
      <output id="safe-value">{JSON.stringify(parseClientRichText(body))}</output>
      <Upload accept=".txt" maxCount={2} fileList={files} onChange={event=>setFiles(event.fileList)}
        customRequest={async options=>{setUploadCalls(n=>n+1);await new Promise(r=>setTimeout(r,350));if(fail)options.onError?.(new Error("Fixture failed"));else options.onSuccess?.({id:"real-fixture-response"});}} />
      <output id="upload-value">{JSON.stringify(files.map(f=>({name:f.name,status:f.status,response:f.response})))}</output><output id="upload-calls">{uploadCalls}</output>
      <div id="standalone-pagination"><Pagination current={page} total={95} pageSize={10} showSizeChanger={false} showQuickJumper onChange={setPage}/></div><output id="page-value">{page}</output>
      <Table rowKey="id" dataSource={Array.from({length:23},(_,i)=>({id:i+1,name:`Row ${i+1}`}))} columns={[{title:"Fixture row",dataIndex:"name"}]} pagination={{pageSize:10}} />
      <Steps current={step} items={[{title:"One"},{title:"Two"},{title:"Three"}]} onChange={setStep}/><Button onClick={()=>setStep(n=>Math.min(n+1,3))}>Next step fixture</Button><Progress percent={step*33}/>
    </section>
    <Button onClick={()=>setOpen(true)}>Open editor</Button>
    <Button loading onClick={()=>setCalls(n=>n+1)}>Busy action</Button><output id="calls">{calls}</output>
    <Button onClick={()=> {applyArcThemeTokens(document.documentElement,!dark);setDark(!dark)}}>Theme test</Button>
    <Button onClick={()=>applyArcThemeTokens(document.documentElement,dark,"#ce0000")}>Tenant red</Button>
    <Button onClick={()=>applyArcThemeTokens(document.documentElement,dark)}>Reset tenant</Button>
    <Button onClick={()=>applyAdminRadiusTokens(document.documentElement,{button:24,input:20,container:28})}>Tenant radius</Button>
    <Form disabled><Form.Item label="Disabled name"><Input aria-label="Disabled name"/></Form.Item>
      <Button>Disabled save</Button><Switch aria-label="Disabled switch"/><Segmented options={["Disabled A","Disabled B"]}/></Form>
    <div id="disabled-extended"><Form disabled><DatePicker value={date}/><ColorPicker value={color}/><RichTextEditor value={body}/><Upload accept=".txt"/></Form></div>
    <Form onFinish={values=>setResult(String(values.name))}><Form.Item name="name" label="Required name" rules={[{required:true,message:"Name required"}]}><Input/></Form.Item>
      <Button htmlType="submit">Save test</Button></Form><output id="result">{result}</output>
    <label><input type="checkbox" checked={fail} onChange={e=>setFail(e.target.checked)}/>Reject action</label>
    <ConfirmAction label="Delete test" prompt="Delete fixture?" onConfirm={async()=>{await new Promise(r=>setTimeout(r,300));if(fail)throw Error("Expected failure")}} confirmTimeout={0} resultTimeout={0}/>
    <ActionButton label="Animated action" resetAfterMs={0} onAction={async()=>{setCalls(n=>n+1);await new Promise(r=>setTimeout(r,500));if(fail)throw Error("Expected failure")}} />
    <Form form={saveForm}><Form.Item name="value" label="Animated value" rules={[{required:true}]}><Input /></Form.Item><Form.Item name="second" label="Second value"><Input /></Form.Item>
      <SaveButton label="Animated save" form={saveForm} resetAfterMs={0} onSave={async()=>{setCalls(n=>n+1);await new Promise(r=>setTimeout(r,300))}} /></Form>
    <CopyButton value="Arc clipboard fixture" label="Copy fixture" />
    <Dropdown trigger={["click"]} menu={{items:[{key:"one",label:"Menu one"},{key:"two",label:"Menu two"}],onClick:({key})=>setResult(key)}}><Button>Actions test</Button></Dropdown>
    <Tabs activeKey={tab} onChange={setTab} items={[{key:"first",label:"First tab",children:<Input aria-label="Preserved field"/>},{key:"second",label:"Second tab",children:<p>Second content</p>}]}/>
    <Button onClick={()=>setTab("second")}>External tab</Button>
    <Drawer title="Test editor" open={open} onClose={()=>setOpen(false)} destroyOnHidden size={560} extra={<Button onClick={()=>setNested(true)}>Nested editor</Button>}>
      <Form><Form.Item label="Editor name"><Input aria-label="Editor name"/></Form.Item>
      <Form.Item label="Choose location"><Select aria-label="Choose location" options={[{value:"A",label:"Location A"},{value:"B",label:"Location B"}]}/></Form.Item></Form>
      <Button onClick={()=>setModal(true)}>Open modal</Button>
      <DatePicker value={date} showTime onChange={next=>setDate(next as any)} />
      <Modal title="Modal test" open={modal} onCancel={()=>setModal(false)} footer={null}><Input aria-label="Modal field"/></Modal>
    </Drawer>
    <Drawer title="Nested editor" open={nested} onClose={()=>setNested(false)} destroyOnHidden size={420}><Input aria-label="Nested field"/></Drawer>
  </main></LocaleProvider></App></ConfigProvider>;
}
const previous=document.getElementById("arc-harness-root");previous?.remove();
const mount=document.createElement("section");mount.id="arc-harness-root";mount.style.cssText="position:fixed;inset:0;z-index:500;overflow:auto;background:var(--background)";
document.body.appendChild(mount);createRoot(mount).render(<Harness/>);
