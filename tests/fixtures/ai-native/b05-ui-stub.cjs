'use strict';
const React = require('react');
exports.Button = props => React.createElement('button', { ...props, type: props.htmlType ?? 'button' }, props.children ?? props.label);
exports.ActionButton = props => React.createElement('button', { ...props, type: 'button', disabled: props.disabled || props.pending }, props.label);
exports.Checkbox = props => React.createElement('input', { ...props, type: 'checkbox' });
exports.Input = props => React.createElement('input', props);
