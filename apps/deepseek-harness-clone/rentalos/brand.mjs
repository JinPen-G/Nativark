// Branding at the existing template's render boundary. Downloaded assets stay intact;
// header, business demos, deployment options and partnership CTA are adapted here.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {capabilityCopy,patchCapabilitiesPage,renderCapabilitiesHTML,replaceCapabilityFigures} from './capabilities.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(directory);
const copy = JSON.parse(await fs.readFile(path.join(directory,'copy.json'),'utf8'));
const localeFiles = {zh:'1486.6291caeba5e678f9.js',en:'9265.53668a0802f129dc.js'};
const jsonLiteral = /JSON\.parse\(((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))\)/;
function dictionary(text) {
  const match = text.match(jsonLiteral);
  if (!match) throw new Error('Template locale JSON was not found');
  return JSON.parse(vm.runInNewContext(match[1], {}, {timeout:100}));
}
const original = {};
const originalMessages = {};
const brandedMessages = {};
function merge(target,updates) {
  for(const [key,value]of Object.entries(updates)) {
    if(value&&typeof value==='object'&&!Array.isArray(value))merge(target[key]??={},value);
    else target[key]=value;
  }
  return target;
}
for (const language of ['zh','en']) {
  originalMessages[language]=dictionary(await fs.readFile(path.join(root,'_next/static/chunks',localeFiles[language]),'utf8'));
  original[language]=originalMessages[language].Index;
  brandedMessages[language]=merge(structuredClone(originalMessages[language]),capabilityCopy[language]);
}
const cache = new Map();
const previewSource = await fs.readFile(path.join(directory,'preview.js'),'utf8');
// The captured CSS module is the single geometry/style source for the preview.
const capturedPage = await fs.readFile(path.join(root,'_next/static/chunks/app/[locale]/harness/page-3efdafc368216782.js'),'utf8');
const capabilityPage = patchCapabilitiesPage(capturedPage);
const capabilityFigures=Object.fromEntries(['zh','en'].map(lang=>[lang,renderCapabilitiesHTML(capabilityPage,lang,brandedMessages[lang])]));
const capturedModules = {self:{webpackChunk_N_E:[]}};
vm.runInNewContext(capturedPage,capturedModules);
const cssModule = {exports:{}};
capturedModules.self.webpackChunk_N_E[0][1][25871](cssModule,cssModule.exports,()=>{});
const previewCSS = cssModule.exports;
function previewHTML(language) {
  // Render only this self-contained demo tree, not arbitrary captured components.
  // This avoids requiring React/Next.js dependencies for the standalone server.
  const react = {
    Fragment:'fragment',
    createElement:(tag,props,...children)=>({tag,props:props||{},children}),
    useState:initial=>[initial,()=>{}],useRef:()=>({current:null}),useEffect:()=>{}
  };
  const component = new Function('t','l','P',previewSource+'\nreturn N;')(react,{useLocale:()=>language},()=>previewCSS);
  const escape = value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#x27;');
  function renderChildren(children) {
    let previousText=false;
    return children.flat(Infinity).filter(node=>node!=null&&typeof node!=='boolean').map(node=>{
      const isText=typeof node==='string'||typeof node==='number';
      const separator=previousText&&isText?'<!-- -->':'';
      previousText=isText;
      return separator+render(node);
    }).join('');
  }
  function render(node) {
    if(node==null||typeof node==='boolean')return '';
    if(Array.isArray(node))return node.map(render).join('');
    if(typeof node!=='object')return escape(node);
    const {tag,props,children}=node;
    if(tag==='fragment')return renderChildren(children);
    const aliases={className:'class',strokeWidth:'stroke-width',strokeLinecap:'stroke-linecap',strokeLinejoin:'stroke-linejoin'};
    const attrs=Object.entries(props).filter(([key,value])=>!/^on/.test(key)&&!['key','ref'].includes(key)&&value!=null&&!(typeof value==='boolean'&&!key.startsWith('aria-')&&!key.startsWith('data-')&&!value)).map(([key,value])=>' '+(aliases[key]||key)+'="'+(typeof value==='boolean'&&!/^(aria|data)-/.test(key)?'':escape(value))+'"').join('');
    return '<'+tag+attrs+(/^(img|br|hr|input)$/.test(tag)?'/>':'>'+renderChildren(children)+'</'+tag+'>');
  }
  return render(component());
}
function replacePreviewHTML(text,language) {
  const start=text.indexOf('<div class="'+previewCSS.viewport+'"');
  if(start<0)return text;
  const tags=/<div\b[^>]*>|<\/div>/g;
  tags.lastIndex=start;
  let depth=0,tag;
  while((tag=tags.exec(text))) {
    depth+=tag[0].startsWith('</')?-1:1;
    if(depth===0)return text.slice(0,start)+previewHTML(language)+text.slice(tags.lastIndex);
  }
  throw new Error('Template preview HTML boundary was not found');
}
function replaceOnce(text, oldValue, newValue) {
  if (!text.includes(oldValue)) throw new Error('Template branding anchor changed: '+oldValue.slice(0,90));
  return text.replace(oldValue,newValue);
}
function functionEnd(text, start) {
  let depth=0, quote=null, escaped=false;
  for(let i=text.indexOf('{',start);i<text.length;i++) {
    const ch=text[i];
    if(quote) {if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch===quote)quote=null;continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;
    if(ch==='}'&&--depth===0)return i+1;
  }
  throw new Error('Template function boundary was not found');
}
function headerAndDownloads(text) {
  // Both the desktop button and mobile-menu entry use the footer's GitHub URL.
  const githubAnchor='href:r._Z.repository';
  if(text.split(githubAnchor).length!==3)throw new Error('Expected desktop and mobile GitHub entries');
  text=text.replaceAll(githubAnchor,'href:'+JSON.stringify(footerSocials[1].href));
  const logoStart=text.indexOf('function m(e){let{className:n}=e;');
  if(logoStart<0)throw new Error('Header logo component changed');
  const logoEnd=functionEnd(text,logoStart);
  text=text.slice(0,logoStart)+'function m(e){let{className:n}=e;return(0,o.jsx)("img",{src:"/harness/icons/rentalos-logo.svg",alt:"Rental OS",height:24,className:"rentalos-header-logo ".concat(n||"")})}'+text.slice(logoEnd);
  text=replaceOnce(text,'label:e("harnessHeaderDownload"),size:"xs",placement:"bottom-end",showIcon:!0', 'label:e("harnessHeaderDownload"),rentalDemo:!0,size:"xs",placement:"bottom-end",showIcon:!1');
  text=replaceOnce(text,'className:"ds-mobile-menu-body",children:[', 'className:"ds-mobile-menu-body",children:[(0,o.jsx)("a",{href:"#demo-request",className:"ds-mobile-menu-item","aria-haspopup":"dialog","aria-controls":"demo-request",onClick:e=>{e.preventDefault(),w(!1),document.dispatchEvent(new CustomEvent("rentalos:request-demo",{detail:{trigger:e.currentTarget}}))},children:e("harnessDemoAction")}),');
  text=replaceOnce(text,'href:n.href,target:"_blank",rel:"noopener noreferrer",onClick:()=>{(0,C.uG)("macOS"===n.platform?"header_download_mac":"header_download_win"),w(!1)},children:e(n.labelKey)', 'href:n.href,"aria-disabled":!0,onClick:e=>e.preventDefault(),children:[(0,o.jsx)("span",{children:e(n.labelKey)}),(0,o.jsx)("span",{className:"rentalos-development",children:e("harnessDownloadDevelopment")})]');
  text=replaceOnce(text,'let P=(0,r.memo)(function(e){let{label:', 'let P=(0,r.memo)(function(e){const rentalDemo=!!e.rentalDemo;const bookDemo=()=>{C(!1);document.dispatchEvent(new CustomEvent("rentalos:request-demo",{detail:{trigger:document.activeElement}}))};let{label:');
  text=replaceOnce(text,'as:"a",href:(0,Z.DS)("/download",c),target:"_blank",rel:"noopener noreferrer",variant:"primary",size:t,icon:l?', 'as:rentalDemo?"button":"a",type:rentalDemo?"button":void 0,href:rentalDemo?void 0:(0,Z.DS)("/download",c),target:rentalDemo?void 0:"_blank",rel:rentalDemo?void 0:"noopener noreferrer","aria-haspopup":rentalDemo?"dialog":void 0,"aria-controls":rentalDemo?"demo-request":void 0,variant:"primary",size:t,icon:l?');
  text=replaceOnce(text,'onClick:()=>null==a?void 0:a(null),children:null!=n?n:d("harnessHeroDownloadDesktop")', 'onClick:()=>rentalDemo?bookDemo():null==a?void 0:a(null),children:null!=n?n:d("harnessHeroDownloadDesktop")');
  text=replaceOnce(text,'note:d(e.noteKey)}),domProps:{role:"menuitem"}', 'note:rentalDemo?d("harnessDownloadDevelopment"):d(e.noteKey)}),domProps:{role:"menuitem","aria-disabled":rentalDemo||void 0}');
  text=replaceOnce(text,'onSelect:e=>{window.open(E.bx[e],"_blank","noopener,noreferrer"),f(e)}', 'onSelect:e=>{if(rentalDemo)return;window.open(E.bx[e],"_blank","noopener,noreferrer"),f(e)}');
  text=replaceOnce(text,'renderTrigger:e=>{let{domProps:r,domRef:i}=e;return v?', 'renderTrigger:e=>{let{domProps:r,domRef:i}=e;return v&&!rentalDemo?');
  text=replaceOnce(text,'):x?(0,o.jsxs)("div",{ref:i,className:"".concat(R().split', '):(x||rentalDemo)?(0,o.jsxs)("div",{ref:i,className:"".concat(R().split');
  text=replaceOnce(text,'as:"a",href:E.bx[x],target:"_blank",rel:"noopener noreferrer",variant:"primary",size:t,className:', 'as:rentalDemo?"button":"a",type:rentalDemo?"button":void 0,href:rentalDemo?void 0:E.bx[x],target:rentalDemo?void 0:"_blank",rel:rentalDemo?void 0:"noopener noreferrer","aria-haspopup":rentalDemo?"dialog":void 0,"aria-controls":rentalDemo?"demo-request":void 0,variant:"primary",size:t,className:');
  text=replaceOnce(text,'onClick:()=>f(x),children:null!=n?n:d(', 'onClick:()=>rentalDemo?bookDemo():f(x),children:null!=n?n:d(');
  return text;
}
function patchPayload(text, language) {
  for(const [key,value] of Object.entries(copy[language])) {
    if (!(key in original[language])) continue;
    const before=JSON.stringify(key)+':'+JSON.stringify(original[language][key]);
    let after=JSON.stringify(key)+':'+JSON.stringify(value);
    if(key==='harnessHeroTitlePre')after=Object.entries(copy[language]).filter(([name])=>!(name in original[language])).map(([name,value])=>JSON.stringify(name)+':'+JSON.stringify(value)).join(',')+','+after;
    text=text.replaceAll(before,after).replaceAll(JSON.stringify(before).slice(1,-1),JSON.stringify(after).slice(1,-1));
  }
  for(const namespace of Object.keys(capabilityCopy[language])) {
    if(namespace==='Index') {
      const before=JSON.stringify('harnessWhyTitle')+':'+JSON.stringify(original[language].harnessWhyTitle);
      const after=JSON.stringify('harnessWhyTitle')+':'+JSON.stringify(capabilityCopy[language].Index.harnessWhyTitle);
      text=text.replaceAll(before,after).replaceAll(JSON.stringify(before).slice(1,-1),JSON.stringify(after).slice(1,-1));
      // Next.js script payloads escape angle brackets in rich-text translations.
      text=text.replaceAll(JSON.stringify(before).slice(1,-1).replaceAll('<','\\u003c').replaceAll('>','\\u003e'),JSON.stringify(after).slice(1,-1));
      continue;
    }
    const before=JSON.stringify(namespace)+':'+JSON.stringify(originalMessages[language][namespace]);
    const after=JSON.stringify(namespace)+':'+JSON.stringify(brandedMessages[language][namespace]);
    text=text.replaceAll(before,after).replaceAll(JSON.stringify(before).slice(1,-1),JSON.stringify(after).slice(1,-1));
  }
  return text;
}
const deploymentButtonClass='ds-btn-primary ds-btn-m';
function deploymentComponent(text) {
  const start=text.indexOf('function ev(){');
  if(start<0)throw new Error('Deployment section component changed');
  const end=functionEnd(text,start);
  let component=text.slice(start,end);
  const body=component.indexOf(';return(0,r.jsxs)("section"');
  if(body<0)throw new Error('Deployment section render boundary changed');
  component='function ev(){let e=(0,l.useTranslations)("Harness.Index"),i=[1,2].map(index=>({label:e("harnessUse"+index+"Label"),desc:e("harnessUse"+index+"Desc"),action:e("harnessUse"+index+"Action"),topic:e("harnessUse"+index+"Inquiry")}))'+component.slice(body);
  component=replaceOnce(component,'className:"ds-container py-ds-10",','className:"ds-container py-ds-10",id:"deployment-options","aria-labelledby":"deployment-title",');
  component=replaceOnce(component,'as:"h2",className:','as:"h2",id:"deployment-title",className:');
  component=replaceOnce(component,'className:"min-w-0 flex flex-col gap-ds-3 p-ds-7"','className:"min-w-0 flex flex-col gap-ds-3 p-ds-7 rentalos-deployment-card-body"');
  component=replaceOnce(component,'className:"ds-text-body text-ds-description leading-[1.7]"','className:"ds-text-body text-ds-description leading-[1.7] rentalos-deployment-description"');
  const commandStart=component.indexOf('n.command&&');
  const commandEnd=component.indexOf(']})]})},n.label',commandStart);
  if(commandStart<0||commandEnd<0)throw new Error('Deployment command panel changed');
  const button='(0,r.jsx)("div",{className:"mt-ds-2",children:(0,r.jsx)("button",{type:"button",className:'+JSON.stringify(deploymentButtonClass)+',"aria-haspopup":"dialog","aria-controls":"demo-request",onClick:event=>document.dispatchEvent(new CustomEvent("rentalos:request-demo",{detail:{trigger:event.currentTarget,topic:n.topic}})),children:n.action})})';
  component=component.slice(0,commandStart)+button+component.slice(commandEnd+3);
  return text.slice(0,start)+component+text.slice(end);
}
function deploymentSection(text,language) {
  const start=text.indexOf('<section class="ds-container py-ds-10">');
  if(start<0)return text;
  const end=text.indexOf('</section>',start)+10;
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const heading=value=>value.split(/([\p{Script=Latin}\p{M}\p{N}]+)/u).map((piece,index)=>index%2?'<span class="harness-heading-latin">'+escape(piece)+'</span>':escape(piece)).join('');
  let section=text.slice(start,end).replace('<section class="ds-container py-ds-10">','<section class="ds-container py-ds-10" id="deployment-options" aria-labelledby="deployment-title">');
  section=section.replace(/(<h2)([^>]*>)[\s\S]*?(<\/h2>)/,(_,a,b,c)=>a+' id="deployment-title"'+b+heading(copy[language].harnessUseTitle)+c);
  let index=0;
  section=section.replace(/(<h3[^>]*>)[\s\S]*?(<\/h3>)/g,(_,a,b)=>a+heading(copy[language]['harnessUse'+(++index)+'Label'])+b);
  index=0;
  section=section.replace(/<p class="ds-text-body text-ds-description leading-\[1\.7\]">[\s\S]*?<\/p>/g,()=>'<p class="ds-text-body text-ds-description leading-[1.7] rentalos-deployment-description">'+escape(copy[language]['harnessUse'+(++index)+'Desc'])+'</p>');
  section=section.replaceAll('class="min-w-0 flex flex-col gap-ds-3 p-ds-7"','class="min-w-0 flex flex-col gap-ds-3 p-ds-7 rentalos-deployment-card-body"');
  index=0;
  section=section.replace(/<div class="mt-ds-2 flex items-center justify-between[^>]*>[\s\S]*?<\/button><\/div>/g,()=>'<div class="mt-ds-2"><button type="button" class="'+deploymentButtonClass+'" aria-haspopup="dialog" aria-controls="demo-request">'+escape(copy[language]['harnessUse'+(++index)+'Action'])+'</button></div>');
  return text.slice(0,start)+section+text.slice(end);
}
function partnershipComponent(text) {
  // Change only the action group: keep the surrounding particle/grid/glow layers
  // and the original motion section, including its viewport/transition settings.
  const start=text.indexOf('(0,r.jsxs)("div",{className:"harness-cta-actions');
  if(start<0)throw new Error('Partnership action group changed');
  const objectStart=text.indexOf('{',start);
  const end=functionEnd(text,objectStart);
  const group=text.slice(start,end);
  const children=group.indexOf('children:[');
  if(children<0)throw new Error('Partnership buttons changed');
  const buttons=[1,2,3,4].map(index=>'(0,r.jsx)(c.zx,{as:"button",type:"button",variant:"'+(index===1?'primary':'secondary')+'","aria-haspopup":"dialog","aria-controls":"demo-request",onClick:event=>document.dispatchEvent(new CustomEvent("rentalos:request-demo",{detail:{trigger:event.currentTarget,topic:e("harnessPartner'+index+'Inquiry")}})),children:e("harnessPartner'+index+'Action")})').join(',');
  return text.slice(0,start)+group.slice(0,children)+'children:['+buttons+']}'+text.slice(end);
}
function partnershipSection(text,language) {
  const start=text.indexOf('<section id="products"');
  if(start<0)throw new Error('Partnership section HTML changed');
  const end=text.indexOf('</section>',start)+10;
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const heading=value=>value.split(/([\p{Script=Latin}\p{M}\p{N}]+)/u).map((piece,index)=>index%2?'<span class="harness-heading-latin">'+escape(piece)+'</span>':escape(piece)).join('');
  let section=text.slice(start,end);
  section=section.replace(/(<h2[^>]*>)[\s\S]*?(<\/h2>)/,(_,a,b)=>a+heading(copy[language].harnessCtaTitle)+b);
  section=section.replace(original[language].harnessCtaDesc,escape(copy[language].harnessCtaDesc));
  let count=0;
  section=section.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g,()=>{
    const index=++count;
    return '<button class="ds-btn-'+(index===1?'primary':'secondary')+' ds-btn-m" type="button" aria-haspopup="dialog" aria-controls="demo-request">'+escape(copy[language]['harnessPartner'+index+'Action'])+'</button>';
  });
  if(count!==4)throw new Error('Expected four partnership buttons');
  return text.slice(0,start)+section+text.slice(end);
}
const footerSocials=[
  {label:'X',href:'https://x.com/_JinPen',viewBox:'0 0 24 24',path:'M18.205 2.25h3.308l-7.227 8.26l8.502 11.24H16.13l-5.214-6.817L4.95 21.75H1.64l7.73-8.835L1.215 2.25H8.04l4.713 6.231zm-1.161 17.52h1.833L7.045 4.126H5.078z'},
  {label:'GitHub',href:'https://github.com/JinPenG-AI',viewBox:'0 0 16 16',path:'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z'}
];
const footerSocialClass='rentalos-footer-social text-ds-secondary hover:text-ds-primary transition-colors';
const footerCredit='Powered by PenG-AI · All rights reserved.';
const footerPolicyClass='ds-text-caption text-ds-primary whitespace-nowrap';
function footerDetailsComponent(text) {
  const start=text.indexOf('(0,r.jsxs)("footer",');
  if(start<0)throw new Error('Footer component changed');
  const end=functionEnd(text,text.indexOf('{',start));
  let footer=text.slice(start,end);
  footer=replaceOnce(footer,'children:[e("harnessFooterLicense")," \\xb7 ",e("harnessFooterCopyright")]','children:'+JSON.stringify(footerCredit));
  for(const [route,key] of [['privacy','harnessFooterPrivacyPolicy'],['terms-of-use','harnessFooterTermsOfUse']]) {
    footer=replaceOnce(footer,'(0,r.jsx)(eP.rU,{href:"/harness/'+route+'",className:"ds-text-caption text-ds-primary transition-opacity hover:opacity-70 whitespace-nowrap",children:e("'+key+'")})','(0,r.jsx)("span",{role:"link","aria-disabled":!0,className:'+JSON.stringify(footerPolicyClass)+',children:e("'+key+'")})');
  }
  return text.slice(0,start)+footer+text.slice(end);
}
function footerDetailsHTML(text) {
  const start=text.indexOf('<footer');
  if(start<0)throw new Error('Footer HTML changed');
  const end=text.indexOf('</footer>',start)+9;
  let footer=text.slice(start,end);
  footer=footer.replace(/(<p class="ds-text-caption text-ds-description text-center">)[\s\S]*?(<\/p>)/,(_,open,close)=>open+footerCredit+close);
  let policies=0;
  footer=footer.replace(/<a\b[^>]*href="\/(?:en\/)?harness\/(?:privacy|terms-of-use)\/?"[^>]*>([\s\S]*?)<\/a>/g,(_,label)=>{
    policies++;
    return '<span role="link" aria-disabled="true" class="'+footerPolicyClass+'">'+label+'</span>';
  });
  if(policies!==2)throw new Error('Expected two footer policy labels');
  return text.slice(0,start)+footer+text.slice(end);
}
function footerSocialComponent(text) {
  const start=text.indexOf('(0,r.jsxs)("div",{className:"flex items-center gap-ds-6 xl:justify-self-start",children:[');
  if(start<0)throw new Error('Footer social component changed');
  const end=functionEnd(text,text.indexOf('{',start));
  const links=footerSocials.map(social=>'(0,r.jsx)("a",{href:'+JSON.stringify(social.href)+',target:"_blank",rel:"noopener noreferrer",className:'+JSON.stringify(footerSocialClass)+',"aria-label":'+JSON.stringify(social.label)+',title:'+JSON.stringify(social.label)+',children:(0,r.jsx)("svg",{width:20,height:20,viewBox:'+JSON.stringify(social.viewBox)+',fill:"currentColor","aria-hidden":!0,focusable:"false",children:(0,r.jsx)("path",{d:'+JSON.stringify(social.path)+'})})})').join(',');
  return text.slice(0,start)+'(0,r.jsxs)("div",{className:"flex items-center gap-ds-6 xl:justify-self-start",children:['+links+']}'+text.slice(end);
}
function footerSocialHTML(text) {
  const marker='<div class="flex items-center gap-ds-6 xl:justify-self-start">';
  const start=text.indexOf(marker,text.indexOf('<footer'));
  if(start<0)throw new Error('Footer social HTML changed');
  const tags=/<div\b[^>]*>|<\/div>/g;
  tags.lastIndex=start;
  let depth=0,tag;
  while((tag=tags.exec(text))) {
    depth+=tag[0].startsWith('</')?-1:1;
    if(depth===0) {
      const links=footerSocials.map(social=>'<a href="'+social.href+'" target="_blank" rel="noopener noreferrer" class="'+footerSocialClass+'" aria-label="'+social.label+'" title="'+social.label+'"><svg width="20" height="20" viewBox="'+social.viewBox+'" fill="currentColor" aria-hidden="true" focusable="false"><path d="'+social.path+'"></path></svg></a>').join('');
      return text.slice(0,start)+marker+links+'</div>'+text.slice(tags.lastIndex);
    }
  }
  throw new Error('Footer social HTML boundary changed');
}
function capabilitySection(text,language) {
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const heading=value=>value.split(/([\p{Script=Latin}\p{M}\p{N}]+)/u).map((piece,index)=>index%2?'<span class="harness-heading-latin">'+escape(piece)+'</span>':escape(piece)).join('');
  text=replaceCapabilityFigures(text,capabilityFigures[language]);
  text=text.replace(/(<h2[^>]*id="harness-capabilities-title"[^>]*>)[\s\S]*?(<\/h2>)/,(_,a,b)=>a+heading(capabilityCopy[language].Index.harnessWhyTitle)+b);
  const keys=['plugins','deliverables','workflow','trace'];
  let index=0;
  const start=text.indexOf('aria-labelledby="harness-capabilities-title"');
  if(start<0)return text;
  const end=text.indexOf('</section>',start);
  let section=text.slice(start,end);
  section=section.replace(/(<h3[^>]*>)[\s\S]*?(<\/h3>)/g,(_,a,b)=>a+heading(capabilityCopy[language].Capabilities[keys[index++]].title)+b);
  for(const key of keys)section=section.replaceAll(originalMessages[language].Capabilities[key].description,escape(capabilityCopy[language].Capabilities[key].description));
  return text.slice(0,start)+section+text.slice(end);
}
export function brandResponse(filename, bytes) {
  if(!/\.(html|txt|js)$/.test(filename))return bytes;
  if(cache.has(filename))return cache.get(filename);
  let text=bytes.toString('utf8');
  const name=path.basename(filename);
  const language=filename.includes(path.sep+'en'+path.sep)?'en':'zh';
  if(name==='1798-9243f5e9edc77fbb.js')text=headerAndDownloads(text);
  else if(name==='page-3efdafc368216782.js') {
    text=patchCapabilitiesPage(text);
    text=deploymentComponent(text);
    text=partnershipComponent(text);
    text=footerSocialComponent(text);
    text=footerDetailsComponent(text);
    text=replaceOnce(text,'children:(0,r.jsx)(x.J,{onDownload:', 'children:(0,r.jsx)(x.J,{rentalDemo:!0,label:e("harnessDemoAction"),showIcon:!1,onDownload:');
    const start=text.indexOf('function N(){');
    if(start<0)throw new Error('Template preview component changed');
    text=text.slice(0,start)+previewSource+'\n'+text.slice(functionEnd(text,start));
  }
  else if(Object.values(localeFiles).includes(name)) {
    const lang=name===localeFiles.en?'en':'zh';
    const data=dictionary(text);
    Object.assign(data.Index,copy[lang]);
    merge(data,capabilityCopy[lang]);
    text=text.replace(jsonLiteral,()=> 'JSON.parse('+JSON.stringify(JSON.stringify(data))+')');
  } else if(name==='index.html'||name==='index.txt') {
    text=patchPayload(text,language);
    if(name==='index.html') {
      const main=text.indexOf('<main');
      if(main>=0) {
        let header=text.slice(0,main);
        header=header.replaceAll('href="https://github.com/deepseek-ai/deepseek-harness"','href="'+footerSocials[1].href+'"');
        header=header.replace(/<svg width="187" height="24"[\s\S]*?<\/svg>/g,'<img src="/harness/icons/rentalos-logo.svg" alt="Rental OS" height="24" class="rentalos-header-logo h-6 w-auto"/>');
        const label=copy[language].harnessDemoAction;
        header=header.replace('class="ds-mobile-menu-body">',`class="ds-mobile-menu-body"><a href="#demo-request" class="ds-mobile-menu-item" aria-haspopup="dialog" aria-controls="demo-request">${label}</a>`);
        const note=copy[language].harnessDownloadDevelopment;
        header=header.replace(/(<a[^>]*href="https:\/\/download\.deepseek\.com\/[^>]*>)([^<]+)(<\/a>)/g,(_,open,title,close)=>open.replace(/ target="[^"]*"| rel="[^"]*"/g,'').replace('>',' aria-disabled="true">')+`<span>${title}</span><span class="rentalos-development">${note}</span>`+close);
        text=header+text.slice(main);
      }
      if(/(?:^|[\\/])(?:en[\\/])?harness[\\/]index.html$/.test(filename)) {
        text=replacePreviewHTML(text,language);
        text=capabilitySection(text,language);
        text=deploymentSection(text,language);
        text=partnershipSection(text,language);
        text=footerSocialHTML(text);
        text=footerDetailsHTML(text);
        text=text.replace(/(<h1[^>]*>)[\s\S]*?(<br\/>)/, '$1<span class="harness-heading-latin">Rental</span> <span class="harness-heading-latin">OS</span>$2');
        for(const key of ['harnessHeroDesc','harnessHeroDesc2'])text=text.replaceAll(original[language][key],copy[language][key]);
        text=text.replace(/(<div class="ds-hero-enter relative z-20 mt-ds-2"[^>]*>)<a[^>]*>[\s\S]*?<\/a>/,`$1<button class="ds-btn-primary ds-btn-m" type="button" aria-haspopup="dialog" aria-controls="demo-request">${copy[language].harnessDemoAction}</button>`);
      }
      text=text.replace('</head>','<link rel="stylesheet" href="/rentalos/site.css"/><script defer src="/rentalos/site.js"></script></head>');
      text=text.replace(/<link\b(?=[^>]*rel="preload")(?=[^>]*href="[^\"]*file-types\/(?:typescript|python)\.svg")[^>]*\/?\s*>/g,'');
    }
  }
  const result=Buffer.from(text);
  cache.set(filename,result);
  return result;
}
