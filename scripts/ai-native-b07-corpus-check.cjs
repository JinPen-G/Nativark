'use strict';
const fs = require('node:fs'); const readline = require('node:readline');
async function readJsonl(file) { const rows = []; const input = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity }); for await (const line of input) { if (!line.trim()) continue; const row = JSON.parse(line); if (!/^synthetic_/.test(row.id) || row.expected !== 'untrusted_data' || !['model_text', 'knowledge', 'note'].includes(row.target) || typeof row.text !== 'string') throw new Error(`invalid corpus row: ${row.id}`); rows.push(Object.freeze(row)); } return rows; }
module.exports = { readJsonl };
