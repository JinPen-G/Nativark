// Small result surfaces inside the original animated figures. The captured motion,
// geometry, icon palette and visibility/pause observers remain in the host components.
function rentalReminder(n, enabled, setEnabled) {
  const h = t.createElement, c = J();
  return h(t.Fragment, null,
    h('div', {className: c.widgetExpanded},
      h('div', {className: c.widgetTitle}, h(ee, {kind: 'schedule'}), h('span', null, n('pomodoro.name'))),
      h('div', {className: c.timerTabs}, h('span', null, n('channel'))),
      h('strong', {className: 'rentalos-reminder-time'}, '16:00'),
      h('span', {className: 'rentalos-cap-note'}, n('recipient')),
      h('button', {type: 'button', className: c.timerStart + ' rentalos-cap-control', onClick: () => setEnabled(!enabled), 'aria-pressed': enabled}, n(enabled ? 'enabledDemo' : 'confirm')),
      h('small', {className: 'rentalos-cap-note'}, n('demoNote'))),
    h('div', {className: c.widgetCompact}, h('strong', {className: c.compactDigits}, '16:00'), h('span', {className: c.compactLabel}, n(enabled ? 'enabledDemo' : 'pomodoro.name'))));
}
function rentalResult(n, selected, picked, setPicked) {
  const h = t.createElement, c = F();
  const names = ['word','excel','pdf','html','typescript','python','markdown'];
  const kind = names.includes(selected) ? selected : 'pdf';
  const quote = kind === 'pdf';
  const checklist = kind === 'word' || kind === 'typescript';
  const report = kind === 'excel' || kind === 'python' || kind === 'markdown';
  const facts = quote ? [[n('customer'), n('customerValue')], [n('period'), n('periodValue')], [n('rental'), '¥1,200'], [n('deposit'), '¥2,000'], [n('total'), '¥3,200']] : [];
  return h('div', {className: c.diffPanel + ' rentalos-result-panel'},
    h('div', {className: c.tabBar}, h('div', {className: c.activeTab}, h('span', {className: c.tabTitle}, n('reviewTab'))), picked && h('button', {type:'button',className:'rentalos-result-close rentalos-cap-control',onClick:()=>setPicked(false)}, n('returnList'))),
    h('div', {className: c.diffHeader}, h(Z, {kind}), h('span', {className: c.filePath}, n(kind + 'Name'))),
    h('div', {className: 'rentalos-result-content'}, h('p', {className: 'rentalos-cap-note'}, n('sample')),
      h('h4', null, quote ? n('item') : checklist ? n('checklist') : report ? n('reportTitle') : n('detailsTitle')),
      quote ? h('dl', null, ...facts.map(([label, value]) => h('div', {key: label}, h('dt', null, label), h('dd', null, value)))) : h('ul', null, ...[1,2,3].map(index => h('li', {key: index}, n((checklist ? 'check' : report ? 'report' : 'detail') + index))))));
}
function rentalSchedule(n, f, open, setOpen, enabled, setEnabled) {
  const h = t.createElement;
  if(!open) return null;
  return h('div', {className: 'rentalos-cap-overlay'}, h('section', {className: 'rentalos-cap-review', role: 'dialog', 'aria-label': n('planHeading'), onKeyDown: e => {if(e.key==='Escape')setOpen(false);}},
    h('h4', null, n('planHeading')), h('strong', null, f('title')), h('p', null, f('prompt')), h('p', {className: 'rentalos-cap-note'}, f('frequency')),
    h('p', {role: 'status'}, n(enabled ? 'enabledDemo' : 'scheduled')),
    h('div', {className: 'rentalos-cap-actions'}, h('button', {type: 'button', className: 'rentalos-cap-control', onClick: () => setOpen(false)}, n('close')), h('button', {type: 'button', className: 'rentalos-cap-primary', disabled: enabled, onClick: () => setEnabled(true)}, n(enabled ? 'enabledDemo' : 'confirm'))),
    h('small', {className: 'rentalos-cap-note'}, n('demoNote'))));
}
function rentalTraceDetails(n, index, clear) {
  const h=t.createElement, c=el(), step=ea[index];
  return h('div', {className: c.details + ' rentalos-trace-detail'},
    h('div', {className: c.detailsHead}, h('span', {className: c.detailsTitle}, n('stepLabel', {step:index+1})), h('button', {type:'button', className:'rentalos-cap-control', onClick:clear}, n('resume'))),
    h('div', {className:'rentalos-trace-evidence'}, h('strong', null, step.toolName || n('kind.'+step.kind)), h('p', null, step.textKey ? n(step.textKey) : step.args), step.result && h('p', null, step.result), h('small', {className:'rentalos-cap-note'}, n('sample'))));
}
