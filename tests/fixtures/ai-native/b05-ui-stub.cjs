'use strict';
const React = require('react');
const clean = ({ children, label, loading, pending, pendingLabel, successLabel, onAction, ...props }) => props;
exports.Button = props => React.createElement('button', { ...clean(props), type: props.htmlType ?? 'button' }, props.children ?? props.label);
exports.ActionButton = props => React.createElement('button', { ...clean(props), type: 'button', disabled: props.disabled || props.pending }, props.pending ? props.pendingLabel ?? '处理中' : props.label);
exports.Checkbox = props => React.createElement('input', { ...clean(props), type: 'checkbox' });
exports.Input = props => React.createElement('input', clean(props));
