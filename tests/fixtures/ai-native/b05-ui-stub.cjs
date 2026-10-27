'use strict';
const React = require('react');
const clean = ({ children, label, loading, pending, pendingLabel, successLabel, onAction, ...props }) => props;
exports.Button = props => React.createElement('button', { ...clean(props), type: props.htmlType ?? 'button' }, props.children ?? props.label);
exports.ActionButton = props => React.createElement('button', { ...clean(props), type: 'button', disabled: props.disabled || props.pending }, props.pending ? props.pendingLabel ?? '处理中' : props.label);
exports.Checkbox = props => React.createElement('input', { ...clean(props), type: 'checkbox' });
exports.Input = props => React.createElement('input', clean(props));
exports.Select = props => React.createElement('select', clean(props), (props.options ?? []).map(option => React.createElement('option', { key: option.value, value: option.value }, option.label)));
// Render the same supplied records/columns; no invented proposal rows or actions.
exports.Table = props => React.createElement('table', null,
  React.createElement('thead', null, React.createElement('tr', null, props.columns.map((column, index) => React.createElement('th', { key: index }, column.title)))),
  React.createElement('tbody', null, props.dataSource.map((record, index) => React.createElement('tr', { key: index }, props.columns.map((column, cell) => React.createElement('td', { key: cell }, record[column.dataIndex]))))));
