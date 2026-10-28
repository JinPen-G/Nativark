// One-time source migration. Generated components are ordinary editable React;
// the running/building website never loads the mirror, webpack chunks or this tool.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {parse} from '@babel/parser';
import traversePackage from '@babel/traverse';
import generatorPackage from '@babel/generator';
import * as t from '@babel/types';
import prettier from 'prettier';
import {brandResponse} from '../../deepseek-harness-clone/rentalos/brand.mjs';

const traverse=traversePackage.default;
const generate=generatorPackage.default;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mirror=path.resolve(root,'../deepseek-harness-clone');
const parseCode=code=>parse(code,{sourceType:'module',plugins:['jsx']});
async function write(file,source,parser='babel') {
  const target=path.join(root,file);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(target,await prettier.format(source,{parser,singleQuote:true}), 'utf8');
}
async function capture(file,branded=true) {
  const filename=path.join(mirror,file);
  const raw=await fs.readFile(filename);
  const ctx={self:{webpackChunk_N_E:[]}};
  vm.runInNewContext(branded?brandResponse(filename,raw).toString():raw.toString(),ctx,{timeout:2000});
  return Object.assign({},...ctx.self.webpackChunk_N_E.map(chunk=>chunk[1]));
}
const pageModules=await capture('_next/static/chunks/app/[locale]/harness/page-3efdafc368216782.js');
const headerModules=await capture('_next/static/chunks/1798-9243f5e9edc77fbb.js');
const uiModules=await capture('_next/static/chunks/6872-942bc441684cc23b.js',false);
const particleModules=await capture('_next/static/chunks/5565.779b207d687b6031.js',false);
const styleIds=new Set([25871,97122,48191,56350,76731,69466,88526]);
const getStyles=id=>{const module={exports:{}};pageModules[id](module);return module.exports;};

const external={
  13743:{E:'motion'},21798:{HarnessHeader:'SiteHeader'},
  89652:{useTranslations:'useTranslations',useLocale:'useLocale'},
  6307:{QE:'EASE_IN_OUT',zx:'Button',sz:'DocumentIcon',dc:'CloseIcon',bM:'MenuIcon'},
  90542:{uG:'trackInteraction',kO:'trackInteraction'},
  65841:{v:'useScroll'},76366:{H:'useTransform'},8282:{q:'useSpring'},
  74267:{J:'DemoDownload'},2312:{T:'PreviewBadge'},60890:{mp:'BrandLogo'},
  27633:{J:'useReducedMotion'},1881:{gq:'assetPath',_Z:'siteLinks',PE:'downloadOptions'},
  27351:{Er:'ChevronDown'},63973:{M:'AnimatePresence'},22637:{S:'LanguageSwitcher'},
  37059:{rU:'LocalizedLink'},48161:{E:'useRegionSnapshot'},
  98795:{D:'useThree',F:'useFrame'},68091:{Xz:'Canvas'}
};
const libraryImports={
  React:['react','*'],motion:['framer-motion','motion'],AnimatePresence:['framer-motion','AnimatePresence'],
  useScroll:['framer-motion','useScroll'],useTransform:['framer-motion','useTransform'],useSpring:['framer-motion','useSpring'],useReducedMotion:['framer-motion','useReducedMotion'],
  useTranslations:['next-intl','useTranslations'],useLocale:['next-intl','useLocale'],
  Three:['three','*'],useThree:['@react-three/fiber','useThree'],useFrame:['@react-three/fiber','useFrame'],Canvas:['@react-three/fiber','Canvas']
};
const localImports={
  SiteHeader:'components/SiteHeader.jsx',DemoDownload:'components/ui/DemoDownload.jsx',PreviewBadge:'components/ui/PreviewBadge.jsx',
  Button:'components/ui/primitives.jsx',EASE_IN_OUT:'components/ui/primitives.jsx',DocumentIcon:'components/ui/primitives.jsx',MenuIcon:'components/ui/primitives.jsx',CloseIcon:'components/ui/primitives.jsx',ChevronDown:'components/ui/primitives.jsx',BrandLogo:'components/ui/primitives.jsx',
  assetPath:'lib/site.js',siteLinks:'lib/site.js',downloadOptions:'lib/site.js',trackInteraction:'lib/site.js',useRegionSnapshot:'lib/site.js',
  LanguageSwitcher:'components/LanguageSwitcher.jsx',LocalizedLink:'components/LocalizedLink.jsx',ParticleField:'components/effects/ParticleField.jsx'
};
function moduleAST(factory) {
  const fn=parseCode('('+factory.toString()+')').program.body[0].expression;
  return t.file(t.program(fn.body.body.filter(node=>t.isFunctionDeclaration(node)||t.isVariableDeclaration(node))));
}
function adapt(ast,rename={}) {
  let scope;
  traverse(ast,{Program(p){scope=p.scope;}});
  const declarations=[];
  for(const statement of ast.program.body)if(t.isVariableDeclaration(statement))for(const declaration of statement.declarations)declarations.push({statement,declaration});
  const remove=new Set();
  for(const {declaration}of declarations) {
    const init=declaration.init;
    if(!t.isCallExpression(init)||!t.isIdentifier(init.callee)||!t.isNumericLiteral(init.arguments[0]))continue;
    const id=init.arguments[0].value,name=declaration.id.name,binding=scope.getBinding(name);
    remove.add(name);
    if(id===88557||id===92650||id===51492) {
      scope.rename(name,id===88557?'React':id===92650?'jsxRuntime':'Three');
      remove.delete(name);remove.add(id===88557?'React':id===92650?'jsxRuntime':'Three');
      continue;
    }
    if(styleIds.has(id)||id===26599||id===6327)continue;
    const mapping=external[id];
    if(!mapping)throw new Error('Unknown source import '+id);
    for(const reference of binding.referencePaths) {
      const member=reference.parentPath;
      if(!member.isMemberExpression())throw new Error('Unexpected module reference '+name);
      const prop=member.node.property.name;
      if(!mapping[prop])throw new Error('Unknown export '+id+'.'+prop);
      member.replaceWith(t.identifier(mapping[prop]));
    }
  }
  const bindings=Object.fromEntries(declarations.map(({declaration})=>[declaration.id.name,declaration.init]));
  for(const {declaration}of declarations) {
    const init=declaration.init;
    if(t.isCallExpression(init)&&t.isMemberExpression(init.callee)&&init.callee.property.name==='n') {
      const source=bindings[init.arguments[0]?.name];
      const id=source?.arguments?.[0]?.value;
      if(styleIds.has(id))declaration.init=t.arrowFunctionExpression([],t.valueToNode(getStyles(id)));
      else remove.add(declaration.id.name);
    }
  }
  ast.program.body=ast.program.body.flatMap(statement=>{
    if(!t.isVariableDeclaration(statement))return [statement];
    return statement.declarations.filter(decl=>!remove.has(decl.id.name)&&decl.id.name!=='eN').map(decl=>t.variableDeclaration(statement.kind,[decl]));
  });
  traverse(ast,{Program(p){p.scope.crawl();for(const[from,to]of Object.entries(rename))if(p.scope.hasOwnBinding(from))p.scope.rename(from,to);}});
  traverse(ast,{
    MemberExpression(p){if(t.isIdentifier(p.node.object,{name:'jsxRuntime'})&&t.isIdentifier(p.node.property,{name:'Fragment'}))p.replaceWith(t.memberExpression(t.identifier('React'),t.identifier('Fragment')));},
    SequenceExpression(p){if(p.node.expressions.length===2&&t.isNumericLiteral(p.node.expressions[0],{value:0}))p.replaceWith(p.node.expressions[1]);},
    Identifier(p){if(p.isReferencedIdentifier({name:'eN'})&&!p.scope.getBinding('eN'))p.replaceWith(t.identifier('ParticleField'));}
  });
  // Decompile JSX-runtime calls into editable JSX, not a runtime compatibility shim.
  traverse(ast,{CallExpression:{exit(p){
    const call=p.node;
    if(!t.isMemberExpression(call.callee)||!t.isIdentifier(call.callee.object,{name:'jsxRuntime'})||!['jsx','jsxs'].includes(call.callee.property.name))return;
    const [tag,props,key]=call.arguments;
    const jsxName=(node,member=false)=>t.isStringLiteral(node)?t.jsxIdentifier(node.value):t.isIdentifier(node)&&(member||/^[A-Z]/.test(node.name))?t.jsxIdentifier(node.name):t.isMemberExpression(node)?t.jsxMemberExpression(jsxName(node.object,true),t.jsxIdentifier(node.property.name)):null;
    let name;
    try{name=jsxName(tag);}catch{return;}
    if(!name||!t.isObjectExpression(props)) {
      const children=props?.properties?.find(prop=>prop.key?.name==='children')?.value;
      const attrs=t.isObjectExpression(props)?t.objectExpression(props.properties.filter(prop=>prop.key?.name!=='children')):props;
      p.replaceWith(t.callExpression(t.memberExpression(t.identifier('React'),t.identifier('createElement')),[tag,attrs||t.nullLiteral(),...(children?[children]:[])]));return;
    }
    const attrs=[];let children;
    if(key&&!t.isNullLiteral(key))attrs.push(t.jsxAttribute(t.jsxIdentifier('key'),t.jsxExpressionContainer(key)));
    for(const prop of props.properties) {
      if(t.isSpreadElement(prop)){attrs.push(t.jsxSpreadAttribute(prop.argument));continue;}
      const name=prop.key.name??prop.key.value;
      if(name==='children'){children=prop.value;continue;}
      attrs.push(t.jsxAttribute(t.jsxIdentifier(String(name)),t.jsxExpressionContainer(prop.value)));
    }
    const childNodes=children?(t.isArrayExpression(children)?children.elements.map(child=>t.jsxExpressionContainer(child||t.nullLiteral())):[t.jsxExpressionContainer(children)]):[];
    p.replaceWith(t.jsxElement(t.jsxOpeningElement(name,attrs,!children),children?t.jsxClosingElement(t.cloneNode(name)):null,childNodes,!children));
  }}});
  traverse(ast,{
    UnaryExpression(p){if(p.node.operator==='!'&&t.isNumericLiteral(p.node.argument))p.replaceWith(t.booleanLiteral(!p.node.argument.value));else if(p.node.operator==='void'&&t.isNumericLiteral(p.node.argument,{value:0}))p.replaceWith(t.identifier('undefined'));},
    JSXAttribute(p){const value=p.node.value;if(t.isJSXExpressionContainer(value)&&t.isStringLiteral(value.expression))p.node.value=value.expression;},
    ReturnStatement(p){if(t.isSequenceExpression(p.node.argument)&&p.parentPath.isBlockStatement()){const expressions=p.node.argument.expressions;p.replaceWithMultiple([...expressions.slice(0,-1).map(t.expressionStatement),t.returnStatement(expressions.at(-1))]);}}
  });
  return ast;
}
const renamed={o:'Heading',h:'hexToRgb',f:'HeroBackground',w:'ReferenceSymbol',j:'ReferenceWordmark',H:'PreviewIcon',N:'BusinessPreview',D:'HeroSection',Z:'FileIcon',W:'FileTypeIcon',G:'ClockIcon',q:'DownIcon',X:'CapabilityIcon',ee:'PluginIcon',es:'ToolIcon',en:'TimerDigits',er:'ToolStepIcon',eu:'TraceIcon',em:'DetailsIcon',e_:'CapabilitiesSection',ev:'DeploymentSection',ew:'InteractiveGrid',eL:'LandingPage',P:'getBusinessStyles',T:'getHeroStyles',F:'getResultStyles',z:'getWorkflowStyles',J:'getPluginStyles',el:'getTraceStyles',eh:'getCapabilityStyles',M:'HERO_BACKGROUND_PARAMS',ex:'capabilityDemos',K:'toolSteps',ea:'traceSteps',ef:'capabilityKinds',A:'scheduleExamples',R:'fileKinds',U:'fileCarouselKinds',B:'referenceDiffLines',I:'workflowToolName',Q:'countdownSamples',$:'pluginCarouselKinds',et:'traceLanes',ei:'traceSpans',ec:'traceKindClasses',ed:'traceSpanClasses',k:'previewIconShapes',y:'newConversationPaths'};
const main=adapt(moduleAST(pageModules[92502]),renamed);
// Split the page's own existing JSX tree at its actual section boundaries.
const landing=main.program.body.find(node=>node.id?.name==='LandingPage');
let sections;
traverse(t.file(t.program([landing])),{JSXElement(p){if(p.node.openingElement.name.name==='main')sections=p.node.children.map(child=>child.expression);}});
if(sections?.length!==5)throw new Error('Expected original five main sections');
for(const [name,jsx]of [['PartnershipSection',sections[3]],['SiteFooter',sections[4]]]) {
  const fn=parseCode(`function ${name}(){const e=useTranslations('Harness.Index');const s=useLocale();}`).program.body[0];
  fn.body.body.push(t.returnStatement(t.cloneNode(jsx,true)));
  main.program.body.push(fn);
}
landing.body=parseCode(`function LandingPage(){return <div data-theme="dark" className="harness-site relative w-full bg-ds-page"><SiteHeader/><main className="relative flex flex-col w-full"><HeroSection/><CapabilitiesSection/><DeploymentSection/><PartnershipSection/><SiteFooter/></main></div>}`).program.body[0].body;
nameLocals(main,'HeroSection',{e:'t',s:'locale',n:'backgroundParams',i:'setBackgroundParams',c:'heroRef',h:'scrollBlur',v:'setScrollBlur',w:'scrollProgress',g:'tiltProgress',C:'smoothProgress',j:'previewTransform'});
nameLocals(main,'CapabilitiesSection',{e:'tIndex',s:'tCapability',n:'reducedMotion',i:'paused',d:'setPaused'});
nameLocals(main,'DeploymentSection',{e:'t',i:'options'});
nameLocals(main,'PartnershipSection',{e:'t',s:'locale'});
nameLocals(main,'SiteFooter',{e:'t',s:'locale'});
const demoNames={plugins:'ReturnReminderDemo',deliverables:'DeliverablesDemo',workflow:'ScheduledOperationsDemo',trace:'ExecutionTraceDemo'};
const demos=main.program.body.find(node=>node.declarations?.[0]?.id.name==='capabilityDemos').declarations[0].init;
for(const property of demos.properties){
  const name=demoNames[property.key.name??property.key.value],fn=property.value;
  if(!name||!t.isFunctionExpression(fn))throw new Error('Capability demo boundary changed');
  main.program.body.push(t.functionDeclaration(t.identifier(name),fn.params,fn.body));
  property.value=t.identifier(name);
}

const groups={};
function group(names,file){for(const name of names.split(' '))groups[name]=file;}
group('LandingPage','components/LandingPage.jsx');
group('HeroSection','components/sections/HeroSection.jsx');
group('HeroBackground hexToRgb HERO_BACKGROUND_PARAMS','components/effects/HeroBackground.jsx');
group('BusinessPreview','components/demos/BusinessPreview.jsx');
group('Heading','components/shared/Heading.jsx');
group('CapabilitiesSection capabilityDemos','components/sections/CapabilitiesSection.jsx');
group('ReturnReminderDemo rentalReminder','components/demos/ReturnReminderDemo.jsx');
group('DeliverablesDemo rentalResult','components/demos/DeliverablesDemo.jsx');
group('ScheduledOperationsDemo rentalSchedule','components/demos/ScheduledOperationsDemo.jsx');
group('ExecutionTraceDemo rentalTraceDetails','components/demos/ExecutionTraceDemo.jsx');
group('DeploymentSection','components/sections/DeploymentSection.jsx');
group('PartnershipSection','components/sections/PartnershipSection.jsx');
group('SiteFooter','components/sections/SiteFooter.jsx');
group('InteractiveGrid','components/effects/InteractiveGrid.jsx');
group('FileIcon FileTypeIcon ClockIcon DownIcon CapabilityIcon PluginIcon ToolIcon TimerDigits ToolStepIcon TraceIcon DetailsIcon PreviewIcon previewIconShapes newConversationPaths','components/shared/CapabilityIcons.jsx');
for(const name of ['getBusinessStyles','getHeroStyles','getResultStyles','getWorkflowStyles','getPluginStyles','getTraceStyles','getCapabilityStyles'])groups[name]='components/shared/styleNames.js';

const definitions=new Map();
for(const node of main.program.body){const name=node.id?.name??node.declarations?.[0]?.id.name;if(name)definitions.set(name,node);}
function freeNames(nodes) {
  const found=new Set();
  traverse(t.file(t.program(nodes.map(node=>t.cloneNode(node,true)))),{ReferencedIdentifier(p){if(!p.scope.getBinding(p.node.name))found.add(p.node.name);}});
  return found;
}
const reachable=new Set();
function visit(name){if(reachable.has(name)||!definitions.has(name))return;reachable.add(name);for(const other of freeNames([definitions.get(name)]))visit(other);}
visit('LandingPage');
for(const name of reachable)groups[name]??='components/shared/demoData.jsx';
const files={};
// Preserve initialization order for data constants and JSX icon maps.
for(const[name,node]of definitions)if(reachable.has(name))(files[groups[name]]??=[]).push(node);
const globalNames=new Set(['window','document','navigator','console','Math','String','Number','Boolean','Object','Array','Set','Map','JSON','Date','RegExp','Promise','Error','Infinity','parseInt','parseFloat','Float32Array','Uint8Array','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout','setInterval','clearInterval','IntersectionObserver','ResizeObserver','CustomEvent','performance','URL','undefined']);
function relativeImport(from,to){let value=path.relative(path.dirname(from),to).replaceAll('\\','/');return value.startsWith('.')?value:'./'+value;}
for(const name of Object.getOwnPropertyNames(globalThis))globalNames.add(name);
globalNames.add('arguments');
async function emit(file,nodes,extra={}) {
  const imports=[];
  for(const name of freeNames(nodes)) {
    const library=libraryImports[name];
    if(library)imports.push(library[1]==='*'?`import * as ${name} from '${library[0]}';`:`import {${library[1]}${library[1]!==name?' as '+name:''}} from '${library[0]}';`);
    else if(extra[name]||groups[name]||localImports[name]) {
      const target=extra[name]||groups[name]||localImports[name];
      if(target!==file)imports.push(`import {${name}} from '${relativeImport(file,target)}';`);
    } else if(!globalNames.has(name))throw new Error('Unresolved source identifier '+name+' in '+file+' '+generate(t.program(nodes)).code.split('\n').filter(line=>line.includes(name)).slice(0,5).join('\n'));
  }
  const body=nodes.map(node=>t.exportNamedDeclaration(node));
  await write(file,`'use client';\n// Migrated component logic; edit this source directly. No captured runtime is loaded.\n${imports.join('\n')}\n${generate(t.program(body),{comments:false}).code}`);
}
for(const[file,nodes]of Object.entries(files))await emit(file,nodes);

const header=adapt(moduleAST(headerModules[21798]),{m:'HeaderLogo',x:'SiteHeader'});
function nameLocals(ast,component,names){traverse(ast,{FunctionDeclaration(p){if(p.node.id.name!==component)return;for(const name of Object.keys(names))if(p.scope.hasOwnBinding(name))p.scope.rename(name,'migration_'+name);for(const[from,to]of Object.entries(names))if(p.scope.hasOwnBinding('migration_'+from))p.scope.rename('migration_'+from,to);p.skip();}});}
nameLocals(header,'SiteHeader',{e:'t',n:'locale',t:'docsUrl',x:'scrolled',v:'setScrolled',g:'menuOpen',w:'setMenuOpen',b:'downloadsOpen',y:'setDownloadsOpen',j:'wideScreen',k:'setWideScreen',H:'heroBadgeVisible',M:'setHeroBadgeVisible',F:'heroBadgeRef'});
await emit('components/SiteHeader.jsx',header.program.body,{HeaderLogo:'components/SiteHeader.jsx'});
const particles=adapt(moduleAST(particleModules[85565]),{s:'ParticleFrameLimiter',c:'ParticleMesh',f:'ParticleField',l:'particlePixels'});
await emit('components/effects/ParticleField.jsx',particles.program.body);
// Copy standalone assets, never the old executable chunks or response patch layer.
const manifest=JSON.parse(await fs.readFile(path.join(mirror,'download-manifest.json'),'utf8'));
for(const item of manifest.files) {
  if(!/^(harness\/(?:images|icons|fonts)\/|fonts\/|favicon\.ico$)/.test(item.path))continue;
  const target=path.join(root,'public',item.path);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.copyFile(path.join(mirror,item.path),target);
}
await fs.copyFile(path.join(mirror,'harness/icons/rentalos-logo.svg'),path.join(root,'public/harness/icons/rentalos-logo.svg'));
const styles=[['b39dbc256e52a1dc.css','foundation'],['826310b8bcf73c16.css','site'],['aa0e993381ed79dc.css','consent'],['5adb47a13a2794be.css','demos'],['016c507a691d5741.css','dropdown']];
for(const [original,name]of styles)await write('styles/'+name+'.css',await fs.readFile(path.join(mirror,'_next/static/css',original),'utf8'),'css');
await fs.copyFile(path.join(mirror,'rentalos/site.css'),path.join(root,'styles/rentalos.css'));
const brandedCopy=JSON.parse(await fs.readFile(path.join(mirror,'rentalos/copy.json'),'utf8'));
const capabilityCopy=JSON.parse(await fs.readFile(path.join(mirror,'rentalos/capability-copy.json'),'utf8'));
const merge=(a,b)=>{for(const[k,v]of Object.entries(b))v&&typeof v==='object'&&!Array.isArray(v)?merge(a[k]??={},v):a[k]=v;return a;};
for(const [locale,file]of [['zh','1486.6291caeba5e678f9.js'],['en','9265.53668a0802f129dc.js']]) {
  const source=await fs.readFile(path.join(mirror,'_next/static/chunks',file),'utf8');
  const literal=source.match(/JSON\.parse\(((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))\)/)[1];
  const messages=JSON.parse(vm.runInNewContext(literal));
  Object.assign(messages.Index,brandedCopy[locale]);merge(messages,capabilityCopy[locale]);
  await write('messages/'+locale+'.json',JSON.stringify({Harness:messages,Demo:Object.fromEntries(Object.entries(brandedCopy.demo).map(([key,value])=>[key.replace('demo.','').replace('cta.',''),value[locale]]))}),'json');
}
await write('migration-manifest.json',JSON.stringify({source:'../deepseek-harness-clone',method:'One-time AST JSX recovery, component boundary extraction and manual native Next.js integrations',runtimeUsesMirror:false,originalFiles:manifest.files,components:Object.keys(files)}),'json');
console.log('Migrated '+Object.keys(files).length+' editable component modules, header, particle field, styles, assets and locale dictionaries.');
