/* Bridges the template's locale/navigation with the existing Rental OS demo form. */
(() => {
  'use strict';
  const language = () => /^\/en(?:\/|$)/.test(location.pathname) ? 'en' : 'zh';
  let pendingOpener = null;
  let pendingTopic = '';
  let suggestedMessage = '';
  let ready = false;
  function applyTopic(topic) {
    const field=document.getElementById('demo-message');
    if (!field || !topic) return;
    // Keep anything the visitor typed; only replace our own prior suggestion.
    if (!field.value || field.value===suggestedMessage) {field.value=topic;suggestedMessage=topic;}
  }
  document.addEventListener('rentalos:request-demo', event => {
    applyTopic(event.detail?.topic);
    if (!ready) pendingTopic=event.detail?.topic || '';
    if (!ready) pendingOpener = event.detail?.trigger || document.activeElement;
  });
  async function init() {
    const [copyResponse, formResponse] = await Promise.all([fetch('/rentalos/copy.json'),fetch('/rentalos/demo-form.html')]);
    if (!copyResponse.ok || !formResponse.ok) throw new Error('Demo form resources unavailable');
    const [copy, html] = await Promise.all([copyResponse.json(),formResponse.text()]);
    const template = document.createElement('template');
    template.innerHTML = html;
    document.body.appendChild(template.content);
    let current = language();
    window.RentalOSCopy = {text: key => copy.demo[key]?.[language()] ?? key,get language(){return language();}};
    function translate() {
      const dialog = document.getElementById('demo-request');
      for(const element of dialog.querySelectorAll('[data-i18n]'))element.textContent=window.RentalOSCopy.text(element.dataset.i18n);
      for(const element of dialog.querySelectorAll('[data-i18n-aria]'))element.setAttribute('aria-label',window.RentalOSCopy.text(element.dataset.i18nAria));
    }
    translate();
    const observer = new MutationObserver(() => {
      const next = language();
      if(next===current)return;
      current=next;
      translate();
      document.dispatchEvent(new Event('rentalos:languagechange'));
    });
    observer.observe(document.body,{subtree:true,childList:true});
    window.addEventListener('popstate',()=>{translate();document.dispatchEvent(new Event('rentalos:languagechange'));});
    await loadScript('/rentalos/config.js');
    await loadScript('/rentalos/demo-request.js');
    ready=true;
    if(pendingOpener){document.dispatchEvent(new CustomEvent('rentalos:request-demo',{detail:{trigger:pendingOpener,topic:pendingTopic}}));pendingOpener=null;pendingTopic='';}
  }
  function loadScript(src) {
    return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});
  }
  // The mobile menu's non-React fallback also uses the same booking action.
  document.addEventListener('click',event=>{
    const unavailable=event.target.closest?.('[aria-disabled="true"][href]');
    if(unavailable)event.preventDefault();
    const trigger=event.target.closest?.('a[href="#demo-request"]');
    if(trigger){event.preventDefault();document.dispatchEvent(new CustomEvent('rentalos:request-demo',{detail:{trigger}}));}
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().catch(console.error),{once:true});
  else init().catch(console.error);
})();
