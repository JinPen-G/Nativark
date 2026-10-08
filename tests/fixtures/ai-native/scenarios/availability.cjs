'use strict';
const { validateScenario } = require('./loader.cjs');
const assets = Object.freeze([{ id: 'synthetic_asset_camera_1', workspaceId: 'synthetic_workspace_1', status: 'available' }, { id: 'synthetic_asset_camera_2', workspaceId: 'synthetic_workspace_2', status: 'reserved' }]);
const windows = Object.freeze([{ id: 'synthetic_window_1', startsAt: '2026-01-10T10:00:00Z', endsAt: '2026-01-10T12:00:00Z' }, { id: 'synthetic_window_2', startsAt: '2026-01-10T11:00:00Z', endsAt: '2026-01-10T13:00:00Z' }]);
const scenarios = Object.freeze(['conflict', 'no_inventory', 'cross_scope'].map(expected => validateScenario({ code: `availability.${expected}`, synthetic: true, actor: { kind: 'staff', id: 'synthetic_staff_1' }, scope: { kind: 'workspace', id: 'synthetic_workspace_1' }, inputRefs: ['synthetic_asset_camera_1', 'synthetic_asset_camera_2', 'synthetic_window_1', 'synthetic_window_2'], expected })));
module.exports = Object.freeze({ assets, windows, scenarios });
