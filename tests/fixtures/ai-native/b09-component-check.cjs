'use strict';
function checkComponent({definition,json,wxml,files}){
 const errors=[];
 if(json.component!==true) errors.push('not component');
 for(const ext of ['js','json','wxml','wxss']) if(!files.includes(ext)) errors.push('missing '+ext);
 for(const match of wxml.matchAll(/\b(?:bind|catch)(?::)?[\w-]+=["']([^"']+)["']/g)) if(typeof definition.methods?.[match[1]]!=='function') errors.push('missing method '+match[1]);
 for(const [alias,ref] of Object.entries(json.usingComponents||{})) if(typeof ref!=='string'||!ref.startsWith('./')) errors.push('unchecked reference '+alias);
 return errors;
}
module.exports={checkComponent};
