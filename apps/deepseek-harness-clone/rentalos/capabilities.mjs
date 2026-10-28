// Response-only adaptation of the four captured capability demos; no source assets
// are overwritten and no real tools, scheduling or notification APIs are called.
import fs from 'node:fs/promises';
import vm from 'node:vm';
const directory=new URL('./',import.meta.url);
export const capabilityCopy=JSON.parse(await fs.readFile(new URL('capability-copy.json',directory),'utf8'));
const helpers=await fs.readFile(new URL('capability-preview.js',directory),'utf8');
function replace(source,before,after) {
  if(!source.includes(before))throw new Error('Capability anchor changed: '+before.slice(0,100));
  return source.replace(before,after);
}
function until(source,start,end,value) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  if(a<0||b<0)throw new Error('Capability boundary changed: '+start);
  return source.slice(0,a)+value+source.slice(b);
}
const toolSteps=[
  {key:'skill',label:'skill',icon:'skill',type:'tool',summaryKey:'capability'},
  {key:'readSkill',label:'read',icon:'read',type:'tool',summaryKey:'permission'},
  {key:'thinkSlot',label:'think',icon:'think',type:'think',summaryKey:'plan'},
  {key:'providers',label:'providers',icon:'inspect',type:'tool',summaryKey:'providers'},
  {key:'querySlots',label:'query',icon:'inspect',type:'tool',summaryKey:'settings'},
  {key:'writeManifest',label:'write',icon:'write',type:'tool',summaryKey:'time'},
  {key:'writeClient',label:'write',icon:'write',type:'tool',summaryKey:'channel'},
  {key:'install',label:'toolCall',icon:'call',type:'call',summaryKey:'draft'},
  {key:'editClient',label:'edit',icon:'write',type:'tool',summaryKey:'recipient'},
  {key:'verify',label:'verify',icon:'shell',type:'tool',summaryKey:'verify'}
];
const traceSteps=[
  {key:'system',kind:'system',textKey:'systemPrompt'},
  {key:'user1',kind:'user',turn:1,textKey:'userTask'},
  {key:'context1',kind:'context',textKey:'runtimeContext'},
  {key:'assistant1',kind:'assistant',textKey:'assistantPlan'},
  {key:'bashA',kind:'tool',toolName:'availability.read',args:'{"location":"Central","kits":2,"days":2}',result:'AVAILABLE · sample'},
  {key:'readA',kind:'tool',toolName:'pricing.read',args:'{"source":"Rental Core quote","sample":true}',result:'CNY 1,200 rental + CNY 2,000 deposit'},
  {key:'readB',kind:'tool',toolName:'booking.prepare',args:'{"status":"draft","confirmationRequired":true}',result:'DRAFT-DEMO-026'},
  {key:'assistant2',kind:'assistant',textKey:'firstDone'},
  {key:'user2',kind:'user',turn:2,textKey:'userFollowUp'},
  {key:'assistant3',kind:'assistant',textKey:'assistantSummary'},
  {key:'list',kind:'tool',toolName:'permission.verify',args:'{"scope":"current tenant","confirmation":"sample"}',result:'CONFIRMED · sample'},
  {key:'grep',kind:'tool',toolName:'booking.submit',args:'{"draft":"DRAFT-DEMO-026","demo":true}',result:'BK-DEMO-026'},
  {key:'readme',kind:'tool',toolName:'receipt.read',args:'{"booking":"BK-DEMO-026"}',result:'RECEIPT-DEMO-026'},
  {key:'assistant4',kind:'assistant',textKey:'assistantWrapUp'}
];
export function patchCapabilitiesPage(source) {
  source=until(source,'let K=[',',Q=Array.from','let K='+JSON.stringify(toolSteps));
  source=until(source,'],ea=[',',ei=[','],ea='+JSON.stringify(traceSteps));
  source=replace(source,'let ef=[',helpers+'\nlet ef=[');
  source=replace(source,'src:(0,S.gq)("/icons/file-types/".concat(s,".svg"))','src:(0,S.gq)("/icons/file-types/".concat("typescript"===s?"pdf":"python"===s?"excel":s,".svg"))');
  const a=source.indexOf('let ef=['),b=source.indexOf(';function e_()',a);
  let demos=source.slice(a,b);
  // Make the branded DOM visible immediately, including reduced-motion visitors.
  demos=demos.replaceAll('"data-ready":c,','"data-ready":!0,');
  demos=demos.replace(/\(0,r\.jsx\)\("img",\{className:(?:J|el)\(\)\.fallback,[\s\S]*?loading:"lazy"\}\),/g,'');
  demos=replace(demos,'[p,h]=(0,t.useState)(!0);return','[p,h]=(0,t.useState)(!0),[rentalEnabled,setRentalEnabled]=(0,t.useState)(!1);return');
  demos=replace(demos,'ref:o,className:J().frame,','ref:o,className:J().frame,"data-rental-capability":"plugins","data-confirmed":rentalEnabled,');
  demos=replace(demos,'className:J().canvas,"aria-hidden":"true"','className:J().canvas');
  demos=demos.replaceAll('(0,r.jsx)(ee,{kind:"pomodoro"})','(0,r.jsx)(ee,{kind:"schedule"})');
  demos=until(demos,'(0,r.jsxs)("div",{className:J().timerWidget,','},deliverables:', '(0,r.jsx)("div",{className:J().timerWidget,children:rentalReminder(n,rentalEnabled,setRentalEnabled)})]})]})');
  demos=replace(demos,'a=(0,t.useRef)(null),[i,o]=(0,t.useState)(!1);return','a=(0,t.useRef)(null),[i,o]=(0,t.useState)(!1),[rentalFile,setRentalFile]=(0,t.useState)("pdf"),[rentalPicked,setRentalPicked]=(0,t.useState)(!1);return');
  demos=replace(demos,'ref:a,className:F().frame,"data-running":i&&!s','ref:a,className:F().frame,"data-rental-capability":"deliverables","data-picked":rentalPicked,"data-running":i&&!s&&!rentalPicked');
  demos=replace(demos,'className:F().composition,"aria-hidden":"true"','className:F().composition');
  demos=replace(demos,'(0,r.jsxs)("div",{className:F().fileCard,style:', '(0,r.jsxs)("button",{type:"button",onClick:()=>{setRentalFile(e);setRentalPicked(!0)},"aria-label":n("preview")+" "+n(e+"Name"),className:F().fileCard+" rentalos-cap-control",style:');
  demos=until(demos,'(0,r.jsxs)("div",{className:F().diffPanel,','},workflow:', 'rentalResult(n,rentalFile,rentalPicked,setRentalPicked)]})})');
  demos=replace(demos,'[m,p]=(0,t.useState)(0),h=A[m]','[m,p]=(0,t.useState)(0),[rentalPlan,setRentalPlan]=(0,t.useState)(!1),[rentalScheduled,setRentalScheduled]=(0,t.useState)(!1),h=A[m]');
  demos=replace(demos,'ref:c,className:z().frame,','ref:c,className:z().frame,"data-rental-capability":"workflow",');
  demos=replace(demos,'"data-running":d&&!s,','"data-running":d&&!s&&!rentalPlan,');
  demos=replace(demos,'children:(0,r.jsx)("div",{className:z().canvas,"aria-hidden":"true"','children:[(0,r.jsx)("div",{className:z().canvas');
  demos=replace(demos,'state:"scheduled",deliveryMode:"host"','state:"draft",deliveryMode:"review"');
  demos=replace(demos,'(0,r.jsx)("span",{className:z().openLabel,children:n("open")})','(0,r.jsx)("button",{type:"button",className:z().openLabel+" rentalos-cap-control",onClick:()=>{setRentalPlan(!0);setRentalScheduled(!1)},children:n("open")})');
  demos=replace(demos,']})]})]})})})},trace:',']})]})]})}),rentalSchedule(n,f,rentalPlan,setRentalPlan,rentalScheduled,setRentalScheduled)]})},trace:');
  // Keep the automatic timeline and add an inspectable business-evidence panel.
  const traceStart=demos.indexOf('trace:function');
  let trace=demos.slice(traceStart);
  trace=replace(trace,'[p,h]=(0,t.useState)(!0);return','[p,h]=(0,t.useState)(!0),[rentalStep,setRentalStep]=(0,t.useState)(null);return');
  trace=replace(trace,'ref:o,className:el().frame,','ref:o,className:el().frame,"data-rental-capability":"trace","data-inspecting":null!==rentalStep,');
  trace=replace(trace,'"data-running":u&&p&&!s,','"data-running":u&&p&&!s&&null===rentalStep,');
  trace=replace(trace,'className:el().canvas,"aria-hidden":"true"','className:el().canvas');
  trace=replace(trace,'ea.map(e=>{var s;','ea.map((e,rentalIndex)=>{var s;');
  trace=replace(trace,'(0,r.jsxs)("div",{className:el().row,','(0,r.jsxs)("button",{type:"button",onClick:()=>setRentalStep(rentalIndex),"aria-label":n("reviewStep")+" "+(rentalIndex+1),className:el().row+" rentalos-cap-control",');
  trace=replace(trace,'(0,r.jsxs)("div",{className:el().details,','null!==rentalStep?rentalTraceDetails(n,rentalStep,()=>setRentalStep(null)):(0,r.jsxs)("div",{className:el().details,');
  trace=trace.replaceAll('"NAVIGATION_OK"','"AVAILABLE · sample"').replaceAll('"2026-08-12 17:30:52.637"','"2026-10-22 09:30:00 · sample"');
  demos=demos.slice(0,traceStart)+trace;
  return source.slice(0,a)+demos+source.slice(b);
}

const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#x27;');
// Render the same captured/adapted React trees for first paint. The lightweight
// bridge only renders this known demo module; it never executes application effects.
export function renderCapabilitiesHTML(source, language, messages) {
  source=replace(source,'function e_(){','s.__capabilities=ex;function e_(){');
  const context={self:{webpackChunk_N_E:[]}};
  vm.runInNewContext(source,context,{timeout:1000});
  const modules=context.self.webpackChunk_N_E[0][1];
  let uid=0;
  const node=(tag,props)=>({tag,props:props||{}});
  const react={Fragment:'fragment',createElement:(tag,props,...children)=>node(tag,{...props,children}),useRef:()=>({current:null}),useEffect:()=>{},useId:()=>':rental-cap-'+uid++ +':',useState:value=>[typeof value==='function'?value():value,()=>{}],forwardRef:fn=>fn,memo:fn=>fn};
  const jsx={jsx:node,jsxs:node,Fragment:'fragment'};
  const translation={useLocale:()=>language,useTranslations:namespace=>{
    const root=namespace.replace(/^Harness\./,'');
    const get=(key,params={})=>{
      let value=key.split('.').reduce((o,k)=>o?.[k],messages[root]);
      if(typeof value!=='string')throw new Error('Missing capability translation: '+namespace+'.'+key);
      return value.replace(/\{(\w+)\}/g,(_,k)=>params[k]??'{'+k+'}');
    };
    get.rich=get;return get;
  }};
  const stub=new Proxy(function(){return stub;},{get:()=>stub});
  const cached=new Map();
  function require(id) {
    if(id===92650)return jsx;
    if(id===88557)return react;
    if(id===89652)return translation;
    if(id===1881)return {gq:value=>'/harness'+value};
    if(cached.has(id))return cached.get(id);
    if(modules[id]&&id!==92502) {const m={exports:{}};modules[id](m,m.exports,require);cached.set(id,m.exports);return m.exports;}
    return stub;
  }
  require.n=x=>()=>x;require.r=()=>{};require.d=(o,defs)=>{for(const[k,v]of Object.entries(defs))Object.defineProperty(o,k,{get:v});};
  const out={};modules[92502]({},out,require);
  function children(value) {
    let previousText=false;
    return [value].flat(Infinity).filter(v=>v!=null&&typeof v!=='boolean').map(v=>{const isText=typeof v==='string'||typeof v==='number';const separator=previousText&&isText?'<!-- -->':'';previousText=isText;return separator+render(v);}).join('');
  }
  function render(value) {
    if(value==null||typeof value==='boolean')return '';
    if(Array.isArray(value))return children(value);
    if(typeof value!=='object')return escape(value);
    const {tag,props}=value;
    if(typeof tag==='function')return render(tag(props));
    if(tag==='fragment')return children(props.children);
    const aliases={className:'class',tabIndex:'tabindex',strokeWidth:'stroke-width',strokeLinecap:'stroke-linecap',strokeLinejoin:'stroke-linejoin',stopColor:'stop-color',fillOpacity:'fill-opacity',clipPath:'clip-path',fillRule:'fill-rule',clipRule:'clip-rule',strokeDasharray:'stroke-dasharray',strokeDashoffset:'stroke-dashoffset',draggable:'draggable'};
    const attrs=Object.entries(props).filter(([k,v])=>v!=null&&!/^on/.test(k)&&!['children','ref','key'].includes(k)&&!(typeof v==='boolean'&&!/^(aria|data)-/.test(k)&&!v)).map(([key,v])=>{
      if(key==='style')v=Object.entries(v).map(([k,val])=>k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())+':'+val).join(';');
      else if(typeof v==='boolean'&&!/^(aria|data)-/.test(key))v='';
      return ' '+(aliases[key]||key)+'="'+escape(v)+'"';
    }).join('');
    return '<'+tag+attrs+(/^(img|input|br|hr)$/.test(tag)?'/>':'>'+children(props.children)+'</'+tag+'>');
  }
  return Object.fromEntries(Object.entries(out.__capabilities).map(([key,component])=>[key,render(component({paused:false}))]));
}

export function replaceCapabilityFigures(html, figures) {
  const names={plugins:'HarnessPluginsPreview_frame',deliverables:'HarnessDeliverablesPreview_frame',workflow:'HarnessWorkflowPreview_frame',trace:'HarnessTracePreview_frame'};
  for(const [key,name]of Object.entries(names)) {
    const pattern=new RegExp('<figure[^>]*class="'+name+'[^>]*>[\\s\\S]*?<\\/figure>');
    const match=html.match(pattern);
    if(!match)continue;
    let figure=figures[key];
    // Keep existing server-generated gradient IDs, so hydration and icon references
    // retain the original component positions rather than inventing random IDs.
    const oldIds=[...match[0].matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    const newIds=[...figure.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    if(oldIds.length===newIds.length)newIds.forEach((id,i)=>{figure=figure.replaceAll(id,oldIds[i]);});
    html=html.replace(pattern,()=>figure);
  }
  return html;
}
