"use strict";
const delta = (content, finish_reason = null) => 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason }] }) + '\r\n\r\n';
const usage = 'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2 } }) + '\r\n\r\n';
const done = 'data: [DONE]\r\n\r\n';
module.exports = { delta, usage, done };
