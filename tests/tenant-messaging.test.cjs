/** 邮箱/邀请/寄件专项离线检查，纯内存依赖；不读取env、不连库或外部邮箱。 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
const apiRequire = require('node:module').createRequire(path.join(__dirname, '../apps/api/package.json'));

function load(file, dependencies = {}) {
  const root = path.join(__dirname, '..'), modules = new Map();
  const sourceFile = candidate => [candidate, `${candidate}.ts`, `${candidate}.js`, path.join(candidate, 'index.ts')]
    .find(filename => fs.existsSync(filename) && fs.statSync(filename).isFile());
  const resolveSource = (name, parent) => {
    if (name.startsWith('.')) return sourceFile(path.resolve(path.dirname(parent), name));
    const match = /^@rental-os\/([^/]+)(.*)$/u.exec(name);
    if (!match) return undefined;
    const directory = path.join(root, 'packages', match[1]), metadata = path.join(directory, 'package.json');
    if (!fs.existsSync(metadata)) return undefined;
    const entry = JSON.parse(fs.readFileSync(metadata, 'utf8')).exports?.[match[2] ? `.${match[2]}` : '.'];
    const target = typeof entry === 'string' ? entry : entry?.require ?? entry?.default ?? entry?.import ?? entry?.types;
    if (typeof target !== 'string') return undefined;
    return sourceFile(path.join(directory, target.replace(/^\.\/dist\//u, 'src/').replace(/\.d\.ts$|\.js$/u, '.ts')));
  };
  const evaluate = filename => {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, experimentalDecorators: true, emitDecoratorMetadata: true }
    }).outputText;
    // 兼容入口与公共实现共用本次fixture，unknown错误身份和邮箱运输不会落回真实依赖。
    new Function('require', 'module', 'exports', '__filename', '__dirname', code)(name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      const source = resolveSource(name, filename);
      return source ? evaluate(source) : apiRequire(name);
    }, module, module.exports, filename, path.dirname(filename));
    return module.exports;
  };
  return evaluate(path.join(root, file));
}
const nest = require('@nestjs/common');
const { Prisma } = apiRequire('@prisma/client');
const codec = load('packages/platform-server/src/modules/integrations/inbound-mail-codec.ts');
const templates = load('apps/api/src/modules/notifications/tenant-mail-templates.ts');
const identity = load('apps/api/src/common/request-identity.ts');
const smtpFile = 'packages/platform-server/src/modules/integrations/smtp-transport.ts';

test('MIME reads UTF-8 and multipart mail without exposing active HTML or attachment bytes', () => {
  const body = Buffer.from('设备归还后仍被收费，请协助核查。').toString('base64');
  const filename = Buffer.from('收据.pdf').toString('base64');
  const mail = [
    'From: =?UTF-8?B?5p2O5piO?= <client@example.com>', 'To: support@example.com', 'Subject: =?UTF-8?B?5a6i6K+J?=',
    'Content-Type: multipart/mixed; boundary="parts"', '', '--parts', 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', body, '--parts', 'Content-Type: application/pdf',
    `Content-Disposition: attachment; filename="=?UTF-8?B?${filename}?="`, 'Content-Transfer-Encoding: base64', '', 'cGRm', '--parts--', 'epilogue ignored'
  ].join('\r\n');
  const parsed = codec.parseInboundMail(Buffer.from(mail));
  assert.equal(parsed.subject, '客诉'); assert.equal(parsed.senderName, '李明');
  assert.equal(parsed.text, '设备归还后仍被收费，请协助核查。');
  assert.deepEqual(parsed.attachments, [{ name: '收据.pdf', contentType: 'application/pdf', size: 3 }]);
  const html = codec.parseInboundMail(Buffer.from('From: client@example.com\r\nSubject: unsafe\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<head>bad</head><script>secret()</script><p>Hello &amp; world</p><img src="https://tracker.example.com">'));
  assert.equal(html.text, 'Hello & world');
  assert.throws(() => codec.parseInboundMail(Buffer.alloc(1048577)), /1 MB/u);
});

test('invitation templates escape all facts and public preview never contains an activation credential', () => {
  const args = { tenantName: '<tenant>', inviteeName: 'A & B', inviterName: '管理员', roleNames: ['<admin>'], workspaceNames: ['影像店'], expiresAt: '2026-11-20T09:00:00Z' };
  const preview = templates.renderOperatorInvitation(args);
  assert.match(preview.html, /&lt;tenant&gt;/u); assert.doesNotMatch(preview.html, /<tenant>|href=/u);
  assert.match(preview.text, /邀请链接已隐藏/u);
  const sent = templates.renderOperatorInvitation({ ...args, activationUrl: 'https://app.example.com/invite#token=valid' });
  assert.match(sent.html, /href="https:\/\/app.example.com\/invite#token=valid"/u);
  assert.doesNotMatch(preview.html, /token=valid/u);
});

class FakeSocket extends EventEmitter {
  constructor(responder) { super(); this.responder = responder; this.commands = []; this.closed = false; }
  write(value) { this.commands.push(value); queueMicrotask(() => this.responder(this, value)); return true; }
  reply(value) { this.emit('data', Buffer.from(value)); }
  destroy() { this.closed = true; this.emit('close'); return this; }
}

function smtpFixture(outcome = 'accepted') {
  const sockets = [];
  const connect = () => {
    const socket = new FakeSocket((self, cmd) => {
      if (cmd.startsWith('EHLO')) self.reply('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (cmd.startsWith('AUTH')) self.reply('235 Authentication successful\r\n');
      else if (cmd.startsWith('MAIL') || cmd.startsWith('RCPT')) self.reply('250 Accepted\r\n');
      else if (cmd === 'DATA\r\n') self.reply('354 Continue\r\n');
      else if (cmd === 'QUIT\r\n') self.reply('221 Closing\r\n');
      else if (outcome === 'unknown') self.destroy();
      else if (outcome === 'refused') self.reply('550 Not accepted\r\n');
      else self.reply('250 Queued\r\n');
    });
    sockets.push(socket); queueMicrotask(() => socket.reply('220 SMTP ready\r\n')); return socket;
  };
  const module = load(smtpFile, { 'node:dns/promises': { lookup: async () => [{ address: '203.0.113.4', family: 4 }] },
    'node:net': { isIP: require('node:net').isIP, connect }, 'node:tls': { connect },
    '../../common/outbound-url': { isPrivateOrLocalHost: address => /^127\.|^10\./u.test(address) } });
  const config = module.smtpConnection({ host: 'smtp.example.com', port: 465, secure: true, fromEmail: 'team@example.com' }, { username: 'account', password: 'test-password' });
  return { module, config, sockets };
}

test('SMTP test never enters DATA; email delivery accepts only the final 250 and preserves unknown outcomes', async () => {
  const check = smtpFixture(); await check.module.runSmtp(check.config);
  assert.equal(check.sockets[0].commands.some(cmd => /MAIL|RCPT|DATA/u.test(cmd)), false);
  const send = smtpFixture(); const msg = { to: 'client@example.com', subject: '邀请加入', text: 'Hello', html: '<p>Hello</p>', messageId: 'abc@example.com' };
  await send.module.runSmtp(send.config, msg);
  assert.ok(send.sockets[0].closed); assert.match(send.sockets[0].commands.join(''), /multipart\/alternative/u);
  const unknown = smtpFixture('unknown'); await assert.rejects(unknown.module.runSmtp(unknown.config, msg), unknown.module.SmtpDeliveryUnknownError);
  assert.equal(unknown.sockets[0].commands.filter(cmd => cmd === 'DATA\r\n').length, 1, 'Unknown completion never starts another send');
  const refused = smtpFixture('refused'); await assert.rejects(refused.module.runSmtp(refused.config, msg), /550/u);
  assert.throws(() => send.module.mimeMessage(send.config, { ...msg, subject: 'Title\r\nBcc: other@example.com' }), /标题/u);
  await assert.rejects(send.module.pinnedMailAddress('127.0.0.1'), /内网/u);
});

test('IMAP uses EXAMINE and PEEK, deduplicates by UID and reads chunked literal bytes', async () => {
  let socket;
  const raw = Buffer.from('From: client@example.com\r\nTo: support@example.com\r\nSubject: Complaint\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nNeed help');
  const connect = () => {
    socket = new FakeSocket((self, cmd) => {
      const tag = cmd.split(' ')[0];
      if (cmd.includes(' LOGIN ')) self.reply(`${tag} OK Login\r\n`);
      else if (cmd.includes(' EXAMINE ')) self.reply(`* OK [UIDVALIDITY 88] Stable\r\n${tag} OK Read only\r\n`);
      else if (cmd.includes(' UID SEARCH ')) self.reply(`* SEARCH 10 11\r\n${tag} OK Search\r\n`);
      else if (cmd.includes('RFC822.SIZE')) self.reply(`* 1 FETCH (UID 11 RFC822.SIZE ${raw.length} INTERNALDATE "15-Nov-2026 10:00:00 +0000")\r\n${tag} OK Metadata\r\n`);
      else if (cmd.includes('BODY.PEEK')) {
        const response = Buffer.concat([Buffer.from(`* 1 FETCH (UID 11 BODY[] {${raw.length}}\r\n`), raw, Buffer.from(`)\r\n${tag} OK Body\r\n`)]);
        self.emit('data', response.subarray(0, 44)); self.emit('data', response.subarray(44));
      }
    });
    queueMicrotask(() => socket.reply('* OK IMAP ready\r\n')); return socket;
  };
  const imap = load('packages/platform-server/src/modules/integrations/imap-reader.ts', { 'node:tls': { connect },
    './smtp-transport': { pinnedMailAddress: async () => ({ address: '203.0.113.4', family: 4 }) }, './inbound-mail-codec': codec });
  const result = await imap.readImapMailbox({ host: 'imap.example.com', port: 993, mailbox: 'INBOX', username: 'account', password: 'test-password' }, { cursor: { uidValidity: '88', uid: 10 } });
  assert.equal(result.messages.length, 1); assert.equal(result.nextUid, 11); assert.equal(result.messages[0].message.text, 'Need help');
  assert.ok(socket.commands.some(cmd => cmd.includes('EXAMINE')));
  assert.ok(socket.commands.some(cmd => cmd.includes('BODY.PEEK[]')));
  assert.ok(!socket.commands.some(cmd => /STORE|EXPUNGE|DELETE|SELECT/u.test(cmd)));
  assert.ok(socket.closed);
});

function invitationsFixture({ existing = false, invitation, persist = false } = {}) {
  const dispatches = [];
  const mailCalls = [];
  const db = {
    user: { findFirst: async () => existing ? { id: 'existing-account' } : null },
    notificationSendLog: { findFirst: async () => ({ status: persist ? dispatches[0]?.status : 'sent' }), create: async args => { dispatches.push(args.data); return args.data; },
      updateMany: async args => { const row = dispatches.find(row => row.id === args.where.id && (!args.where.status || row.status === args.where.status));
        if (row) Object.assign(row, args.data); return { count: persist ? Number(Boolean(row)) : 1 }; } },
    tenant: { findUnique: async () => ({ name: 'Tenant', code: 'test', status: 'ACTIVE' }) },
    $queryRaw: async query => query.sql.includes('FROM Tenant') ? [{ name: 'Tenant', code: 'test', status: 'ACTIVE' }]
      : query.sql.includes('idempotencyKey') ? invitation ? [invitation] : [] : query.sql.includes('email =') ? [] : invitation ? [invitation] : [],
    $executeRaw: async query => {
      if (persist && query.sql.includes('INSERT INTO tenant_operator_invitations')) {
        const [id, tenantId, email, displayName, tokenHash, idempotencyKey, requestHash, invitedBy, accessSnapshot, dispatchId, expiresAt, createdAt] = query.values;
        invitation = { id, tenantId, email, displayName, tokenHash, idempotencyKey, requestHash, invitedBy, accessSnapshot, dispatchId, expiresAt, createdAt, status: 'pending', acceptedAt: null };
      }
      if (persist && query.sql.includes("status = 'accepted'")) Object.assign(invitation, {
        status: 'accepted', acceptedAt: new Date(), acceptedUserId: query.values[0]
      });
      return 1;
    },
    $transaction: async callback => callback(db)
  };
  const integrations = { assertEnabledInTransaction: async () => {} };
  const runtime = { configuration: async () => ({ id: 'smtp-config', settings: { fromEmail: 'team@example.com' }, credentials: {} }), send: async (...args) => { mailCalls.push(args); return { messageId: 'id@example.com' }; } };
  const account = { assertTenantManagementPermission: async () => {}, validateOperatorInvitationAccess: async () => ({ actorName: 'Manager', roleNames: ['Operator'], workspaceNames: ['Workspace'] }) };
  const SmtpUnknown = smtpFixture().module.SmtpDeliveryUnknownError;
  const deps = { '../database/prisma.service': {}, '../platform/platform.repository': {}, '../platform/platform.service': {},
    '../../common/password': load('apps/api/src/common/password.ts'),
    '../integrations/tenant-integration.service': {}, '../integrations/tenant-email.runtime.service': {},
    '../integrations/smtp-transport': { normalizeEmail: email => email.toLowerCase(), SmtpDeliveryUnknownError: SmtpUnknown },
    '../../common/request-identity': identity, './tenant-mail-templates': templates,
    './tenant-messaging-storage': load('apps/api/src/modules/notifications/tenant-messaging-storage.ts') };
  const { TenantOperatorInvitationsService } = load('apps/api/src/modules/notifications/tenant-operator-invitations.service.ts', deps);
  const service = new TenantOperatorInvitationsService(db, { get: key => key === 'ADMIN_PUBLIC_URL' ? 'https://app.example.com' : 'test' },
    { getSecurityBaseline: async () => ({ passwordPolicy: { minLength: 8 } }) }, account, integrations, runtime);
  return { service, db, runtime, account, SmtpUnknown, dispatches, mailCalls };
}

test('oversized and malformed IMAP messages retain safe UID records while later mail continues', async () => {
  const headers = Buffer.from('From: client@example.com\r\nTo: support@example.com\r\nSubject: Large complaint\r\nMessage-ID: <original@example.com>\r\n\r\n');
  const malformed = Buffer.from('From: client@example.com\r\nSubject: Broken MIME\r\nContent-Type: multipart/mixed\r\n\r\nunsafe body');
  const normal = Buffer.from('From: client@example.com\r\nSubject: Later complaint\r\nContent-Type: text/plain\r\n\r\nNeed help');
  const sockets = [];
  const connect = () => {
    const socket = new FakeSocket((self, command) => {
      const tag = command.split(' ')[0];
      if (command.includes(' LOGIN ')) self.reply(`${tag} OK Login\r\n`);
      else if (command.includes(' EXAMINE ')) self.reply(`* OK [UIDVALIDITY 88] Stable\r\n${tag} OK Read only\r\n`);
      else if (command.includes(' UID SEARCH ')) self.reply(`* SEARCH 11 12 13\r\n${tag} OK Search\r\n`);
      else {
        const uid = Number(/UID FETCH (\d+)/u.exec(command)?.[1]);
        const raw = uid === 11 ? headers : uid === 12 ? malformed : normal;
        if (command.includes('RFC822.SIZE')) self.reply(`* 1 FETCH (UID ${uid} RFC822.SIZE ${uid === 11 ? 1048577 : raw.length} INTERNALDATE "15-Nov-2026 10:00:00 +0000")\r\n${tag} OK Metadata\r\n`);
        else {
          if (uid === 11) assert.match(command, /BODY\.PEEK\[HEADER\.FIELDS .*<0\.65536>/u);
          self.reply(`* 1 FETCH (UID ${uid} BODY[] {${raw.length}}\r\n${raw.toString()} )\r\n${tag} OK Body\r\n`);
        }
      }
    });
    sockets.push(socket); queueMicrotask(() => socket.reply('* OK IMAP ready\r\n')); return socket;
  };
  const imap = load('apps/api/src/modules/integrations/imap-reader.ts', { 'node:tls': { connect },
    './smtp-transport': { pinnedMailAddress: async () => ({ address: '203.0.113.4', family: 4 }) }, './inbound-mail-codec': codec });
  const config = { host: 'imap.example.com', port: 993, mailbox: 'INBOX', username: 'account', password: 'test-password' };
  const result = await imap.readImapMailbox(config, { cursor: { uidValidity: '88', uid: 10 } });
  assert.equal(result.nextUid, 13); assert.equal(result.checked, 3); assert.equal(result.messages.length, 3);
  assert.deepEqual(result.messages[0].issue, { reason: 'size_limit', size: 1048577 });
  assert.equal(result.messages[0].message.subject, 'Large complaint');
  assert.match(result.messages[0].message.text, /正文和附件未导入.*UID 11/u);
  assert.equal(result.messages[1].issue.reason, 'parse_failed');
  assert.doesNotMatch(result.messages[1].message.text, /unsafe body/u);
  assert.equal(result.messages[2].message.text, 'Need help'); assert.equal(result.messages[2].issue, undefined);
  const next = await imap.readImapMailbox(config, { cursor: { uidValidity: '88', uid: result.nextUid } });
  assert.equal(next.messages.length, 0); assert.equal(next.nextUid, 13);
  assert.ok(sockets.every(socket => socket.closed));
  assert.ok(sockets.every(socket => !socket.commands.some(command => /STORE|EXPUNGE|DELETE|SELECT/u.test(command))));
});
const manager = { tenantId: 'tenant-a', userId: 'manager', audience: 'operator', isSaasAdmin: false };
const request = { email: 'client@example.com', roleIds: ['operator'], workspaceAccesses: [{ workspaceId: 'workspace', roleId: 'operator', isActive: true }], idempotencyKey: 'invite-operation-001' };

test('existing operator accounts stop invitation before configuration or sending is touched', async () => {
  const fixture = invitationsFixture({ existing: true });
  fixture.runtime.configuration = async () => { throw new Error('must never load email credentials'); };
  await identity.runWithRequestIdentity(manager, async () => {
    assert.equal((await fixture.service.checkEmail(request.email)).exists, true);
    await assert.rejects(fixture.service.send(request), /已有当前租户运营账号/u);
  });
  assert.equal(fixture.dispatches.length, 0); assert.equal(fixture.mailCalls.length, 0);
});

test('replay of the same invitation key reads its original outcome without a second email', async () => {
  const hash = require('node:crypto').createHash('sha256').update(JSON.stringify({ email: request.email, displayName: 'client', roleIds: request.roleIds, workspaceAccesses: request.workspaceAccesses })).digest('hex');
  const row = { id: 'original-invite', tenantId: manager.tenantId, email: request.email, displayName: 'client', requestHash: hash,
    accessSnapshot: { roleNames: ['Operator'], workspaceNames: ['Workspace'] }, dispatchId: 'original-dispatch', status: 'pending',
    expiresAt: new Date(Date.now() + 86400000), createdAt: new Date(), acceptedAt: null };
  const fixture = invitationsFixture({ invitation: row });
  fixture.runtime.configuration = async () => { throw new Error('replay must not configure or send'); };
  await identity.runWithRequestIdentity(manager, async () => {
    const result = await fixture.service.send(request); assert.equal(result.id, 'original-invite');
    await assert.rejects(fixture.service.send({ ...request, displayName: 'Other' }), /同一操作键/u);
  });
  assert.equal(fixture.mailCalls.length, 0);
});

test('accepting an expired or existing-account invitation cannot create a user', async () => {
  const row = { id: 'inv', tenantId: manager.tenantId, email: request.email, status: 'pending', expiresAt: new Date(Date.now() - 1000) };
  const fixture = invitationsFixture({ invitation: row });
  await assert.rejects(fixture.service.accept({ token: 'A'.repeat(43), password: 'Test!1234', displayName: 'Client' }), /到期/u);
  const blocked = invitationsFixture({ existing: true, invitation: { ...row, expiresAt: new Date(Date.now() + 86400000) } });
  await assert.rejects(blocked.service.inspect('A'.repeat(43)), /已有账号/u);
});

test('invitation delivery records accepted, failed and unknown outcomes without replaying SMTP', async () => {
  for (const outcome of ['sent', 'failed', 'delivery_uncertain']) {
    const fixture = invitationsFixture({ persist: true });
    if (outcome !== 'sent') fixture.runtime.send = async (...args) => { fixture.mailCalls.push(args); throw outcome === 'failed' ? new Error('SMTP rejected') : new fixture.SmtpUnknown(); };
    await identity.runWithRequestIdentity(manager, async () => {
      const row = await fixture.service.send(request);
      assert.equal(row.deliveryStatus, outcome);
      assert.equal((await fixture.service.send(request)).id, row.id);
    });
    assert.equal(fixture.mailCalls.length, 1);
    const stored = JSON.stringify(fixture.dispatches);
    assert.doesNotMatch(stored, /token=|password|authorization/iu);
    assert.equal(fixture.dispatches[0].responseJson.attempts, 1);
  }
});

test('acceptance uses one transaction for current permission validation, account grants and consuming the token', async () => {
  const row = { id: 'inv', tenantId: manager.tenantId, email: request.email, invitedBy: 'manager', status: 'pending',
    accessSnapshot: { roleIds: request.roleIds, workspaceAccesses: request.workspaceAccesses }, expiresAt: new Date(Date.now() + 86400000) };
  const fixture = invitationsFixture({ invitation: row, persist: true });
  let created = 0;
  fixture.account.acceptOperatorInvitationInTransaction = async (tx, tenant, actor, input, passwordHash) => {
    assert.equal(tx, fixture.db); assert.equal(tenant, 'tenant-a'); assert.equal(actor, 'manager');
    assert.deepEqual(input.workspaceAccesses, request.workspaceAccesses);
    assert.equal(load('apps/api/src/common/password.ts').verifyPassword(passwordHash, 'Test!1234'), true);
    created++; return 'new-user';
  };
  assert.equal((await fixture.service.accept({ token: 'A'.repeat(43), password: 'Test!1234', displayName: 'Client' })).tenantCode, 'test');
  assert.equal(created, 1); assert.equal(row.status, 'accepted');
  assert.equal((await fixture.service.accept({ token: 'A'.repeat(43), password: 'Changed!1234', displayName: 'Changed' })).tenantCode, 'test');
  assert.equal(created, 1);
  const denied = invitationsFixture({ invitation: { ...row, status: 'pending' } });
  denied.account.acceptOperatorInvitationInTransaction = async () => { throw new nest.ForbiddenException('inviter no longer authorized'); };
  await assert.rejects(denied.service.accept({ token: 'A'.repeat(43), password: 'Test!1234', displayName: 'Client' }), /no longer authorized/u);
});

test('lost invitation acceptance replies are recovered by the original credential without granting or resetting twice', async () => {
  const row = { id: 'lost-invitation', tenantId: manager.tenantId, email: request.email, invitedBy: 'manager', status: 'pending',
    accessSnapshot: { roleIds: request.roleIds, workspaceAccesses: request.workspaceAccesses }, expiresAt: new Date(Date.now() + 86400000) };
  const fixture = invitationsFixture({ invitation: row, persist: true });
  let created = 0;
  fixture.account.acceptOperatorInvitationInTransaction = async () => { created++; return 'original-user'; };
  fixture.db.$transaction = async callback => { await callback(fixture.db); throw Error('commit reply lost'); };
  await assert.rejects(fixture.service.accept({ token: 'A'.repeat(43), password: 'Test!1234', displayName: 'Client' }), /commit reply lost/u);
  row.expiresAt = new Date(0);
  const result = await fixture.service.inspect('A'.repeat(43));
  assert.deepEqual(Object.keys(result).sort(), ['message', 'status', 'tenantCode']);
  assert.equal(result.status, 'accepted'); assert.equal(result.tenantCode, 'test');
  assert.equal((await fixture.service.accept({ token: 'A'.repeat(43), password: 'Changed!1234', displayName: 'Changed' })).tenantCode, 'test');
  assert.equal(created, 1); assert.equal(row.acceptedUserId, 'original-user');
  await assert.rejects(fixture.service.inspect('invalid'), nest.NotFoundException);
  row.status = 'revoked'; await assert.rejects(fixture.service.inspect('A'.repeat(43)), /到期|撤回/u);
});

test('invitation page reads a lost acceptance result without resending passwords or account grants', async () => {
  const React = require('react'), slots = [], effects = [], cleanups = [];
  let cursor = 0, accepted = false, reads = 0, sends = 0, resets = 0;
  const pending = { status: 'pending', tenantName: 'Tenant', tenantCode: 'test', email: 'client@example.com', displayName: 'Client',
    roleNames: ['Operator'], workspaceNames: ['Workspace'], minPasswordLength: 8, expiresAt: new Date().toISOString() };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, dependencies) { const index = cursor++;
      if (!slots[index] || dependencies.some((value, offset) => value !== slots[index][offset])) { slots[index] = dependencies; effects.push(effect); } }
  };
  const leaf = name => props => React.createElement(name, props), form = { setFieldValue() {}, resetFields() { resets++; }, getFieldValue() {} };
  const Form = Object.assign(leaf('form'), { useForm: () => [form], useWatch: () => '', Item: leaf('field') });
  const previousWindow = global.window, previousDocument = global.document;
  global.window = { location: { hash: `#token=${'A'.repeat(43)}` } }; global.document = { title: '' };
  try {
    const page = load('apps/admin/src/features/tenant-access/AcceptOperatorInvitationPage.tsx', {
      react: hooks, 'react-router-dom': { useNavigate: () => () => {} }, '@/app/locale': { useLocale: () => ({ t: value => value }) },
      '@/app/branding': { ADMIN_BRAND_NAME: 'App', ADMIN_DEFAULT_MARK: '' },
      '@/api/tenantMessaging': { operatorInvitationApi: {
        inspect: async token => { reads++; assert.equal(token, 'A'.repeat(43)); return accepted ? { status: 'accepted', tenantCode: 'test', message: 'accepted' } : pending; },
        accept: async () => { sends++; accepted = true; throw Error('lost response'); }
      } },
      '@/components/ui': { Form, Input: Object.assign(leaf('input'), { Password: leaf('password') }), Alert: leaf('alert'), Button: leaf('button'),
        ActionButton: leaf('action'), PasswordStrength: leaf('strength'), SaveButton: leaf('save') },
      '@/components/LoadingState': { LoadingState: leaf('loading') },
      '@/registry/blocks/login-centered/login-centered.module.css': { default: {} }
    });
    const render = () => { cursor = 0; const tree = page.AcceptOperatorInvitationPage(); effects.splice(0).forEach(effect => cleanups.push(effect())); return tree; };
    const nodes = tree => { const all = []; const visit = node => React.Children.forEach(node, child => {
      if (React.isValidElement(child)) { all.push(child); visit(child.props.children); }
    }); visit(tree); return all; };
    render(); await new Promise(resolve => setImmediate(resolve));
    let tree = render(); const save = nodes(tree).find(node => node.props.onSave);
    await assert.rejects(save.props.onSave({ displayName: 'Client', password: 'Original!1234' }), /lost response/u);
    tree = render(); assert.equal(nodes(tree).find(node => node.props.onSave).props.disabled, true);
    await nodes(tree).find(node => node.props.label === '核对原接受结果').props.onAction();
    tree = render(); assert.equal(nodes(tree).some(node => node.props.onSave), false);
    assert.ok(nodes(tree).some(node => node.props.children === '前往登录'));
    assert.equal(reads, 2); assert.equal(sends, 1); assert.equal(resets, 1);
  } finally {
    cleanups.forEach(cleanup => cleanup?.()); global.window = previousWindow; global.document = previousDocument;
  }
});

test('public messaging schemas distinguish minimal accepted receipts from pending invitation details', () => {
  const { TENANT_MESSAGING_SCHEMAS } = load('apps/api/src/contracts/tenant-messaging-schemas.ts');
  const Ajv = require('ajv'), validator = new Ajv({ strict: false, validateFormats: false }).compile(TENANT_MESSAGING_SCHEMAS.TenantOperatorInvitationPreview);
  assert.equal(validator({ status: 'accepted', tenantCode: 'test', message: 'accepted' }), true);
  assert.equal(validator({ status: 'accepted', tenantCode: 'test', message: 'accepted', acceptedUserId: 'private-id' }), false);
  assert.equal(validator({ status: 'pending', tenantCode: 'test', message: 'accepted' }), false);
  assert.equal(TENANT_MESSAGING_SCHEMAS.SyncTenantSupportEmailsResult.required.includes('quarantined'), true);
});

test('verification SMS dispatch preserves unknown delivery and only reports failures with structured evidence', async () => {
  const runtime = load('apps/api/src/modules/integrations/tenant-integration.runtime.service.ts', {
    '../database/prisma.service': {}, './tenant-integration.service': {}, '../../common/outbound-url': {}
  });
  const { TenantDispatchService } = load('apps/api/src/modules/notifications/tenant-dispatch.service.ts', {
    '../database/prisma.service': {}, '../platform/platform.repository': {}, '../../common/operation-log.service': {}, '../../common/request-identity': identity
  });
  for (const outcome of ['sent', 'failed', 'delivery_uncertain', 'legacy']) {
    let stored;
    const db = { externalAdapterLog: { create: async ({ data }) => { stored = { ...data, id: 'sms-log', createdAt: new Date() }; }, findFirst: async () => stored } };
    const service = new runtime.TenantIntegrationRuntimeService(db, { runtimeConfig: async () => ({ provider: 'aliyun_sms', capability: 'sms' }) });
    let sends = 0;
    service.sendAliyun = async () => { sends++; if (outcome === 'sent') return 'provider-receipt';
      throw outcome === 'failed' ? new nest.ServiceUnavailableException('provider rejected') : new runtime.NotificationDeliveryUnknownError(); };
    if (outcome === 'sent') await service.sendVerificationSms(manager.tenantId, '13800138000', '654321', 'original-sms');
    else await assert.rejects(service.sendVerificationSms(manager.tenantId, '13800138000', '654321', 'original-sms'));
    assert.equal(sends, 1);
    assert.doesNotMatch(JSON.stringify(stored), /654321|13800138000/u);
    if (outcome === 'legacy') { stored.status = 'failed'; stored.responseJson = undefined; }
    const dispatch = new TenantDispatchService(db, { assertTenantManagementPermission: async () => {} }, { record: async () => {} });
    await identity.runWithRequestIdentity(manager, async () => {
      const result = await dispatch.detail('verification', 'sms-log', 'sms');
      assert.equal(result.status, outcome === 'legacy' ? 'delivery_uncertain' : outcome);
      assert.equal(Boolean(result.sentAt), outcome === 'sent');
    });
  }
});

test('tenant dispatch queries include exact tenant boundaries and return no encrypted recipients', async () => {
  const statements = [];
  const db = { $queryRaw: async query => { statements.push(query); return query.sql.includes('COUNT(*)') ? [{ total: 0 }] : []; } };
  const { TenantDispatchService } = load('apps/api/src/modules/notifications/tenant-dispatch.service.ts', {
    '../database/prisma.service': {}, '../platform/platform.repository': {}, '../../common/operation-log.service': {}, '../../common/request-identity': identity
  });
  const service = new TenantDispatchService(db, { assertTenantManagementPermission: async (tenant, user) => { assert.equal(tenant, 'tenant-a'); assert.equal(user, 'manager'); } }, {});
  await identity.runWithRequestIdentity(manager, async () => {
    assert.deepEqual(await service.list({ channel: 'sms', page: 1, pageSize: 30 }), { rows: [], total: 0, page: 1, pageSize: 30 });
  });
  assert.equal(statements.length, 2);
  for (const query of statements) {
    assert.equal(query.values.filter(value => value === 'tenant-a').length, 4);
    assert.ok(!query.sql.includes('recipientEncrypted')); assert.ok(!query.sql.includes('tokenHash'));
    assert.match(query.sql, /JSON_EXTRACT\(responseJson, '\$\.deliveryStatus'\).*'failed'[\s\S]*ELSE 'delivery_uncertain'/u);
  }
  await identity.runWithRequestIdentity({ ...manager, isSaasAdmin: true }, () => assert.rejects(service.list(), /查看权限/u));
});

test('support sync commits mail and cursor together, rejects a lost lease or changed configuration, and preserves duplicate UIDs', async () => {
  for (const scenario of ['success', 'quarantined', 'lost-lease', 'changed-config', 'write-failure', 'quarantine-log-failure']) {
    const settings = { receiveEnabled: true };
    const updatedAt = new Date('2026-11-15T00:00:00Z');
    const statements = [];
    const state = { emails: new Set(), lastUid: 10, audits: [] };
    let mailboxReads = 0;
    let transactionChecks = 0;
    const db = {
      $executeRaw: async query => { statements.push(query); return 1; },
      $queryRaw: async () => [{ id: 'mailbox', uidValidity: '88', lastUid: BigInt(state.lastUid) }],
      $transaction: async callback => {
        const draft = { emails: new Set(state.emails), lastUid: state.lastUid, audits: [...state.audits] };
        const tx = {
          operationLog: { create: async ({ data }) => {
            if (scenario === 'quarantine-log-failure') throw Error('quarantine audit unavailable');
            draft.audits.push(data);
          } },
          tenantIntegrationConfig: { findFirst: async () => ({
            settings,
            updatedAt: scenario === 'changed-config' ? new Date(updatedAt.getTime() + 1) : updatedAt
          }) },
          $queryRaw: async query => {
            statements.push(query);
            if (query.sql.includes('FOR UPDATE')) return scenario === 'lost-lease' ? [] : [{ id: 'mailbox' }];
            return draft.emails.has(query.values[1]) ? [{ id: query.values[1] }] : [];
          },
          $executeRaw: async query => {
            statements.push(query);
            if (query.sql.includes('INSERT INTO tenant_support_emails')) {
              draft.emails.add(query.values[0]);
              if (scenario === 'write-failure') throw new Error('storage unavailable');
            }
            if (query.sql.includes('SET uidValidity')) draft.lastUid = query.values[1];
            return 1;
          }
        };
        const result = await callback(tx);
        state.emails = draft.emails;
        state.lastUid = draft.lastUid;
        state.audits = draft.audits;
        return result;
      }
    };
    const { TenantSupportEmailService } = load('apps/api/src/modules/notifications/tenant-support-email.service.ts', {
      '../database/prisma.service': {}, '../platform/platform.repository': {},
      '../../common/operation-log.service': {}, '../../common/request-identity': identity,
      '../integrations/tenant-email.runtime.service': {},
      '../integrations/smtp-transport': { smtpConnection: () => ({}) },
      '../integrations/imap-reader': {
        imapConnection: () => ({ host: 'imap.example.com', port: 993, mailbox: 'INBOX', username: 'account' }),
        readImapMailbox: async (connection, options) => {
          mailboxReads++;
          assert.deepEqual(options.cursor, { uidValidity: '88', uid: state.lastUid });
          return { uidValidity: '88', nextUid: 11, checked: 1, hasMore: false, messages: [{
            uidValidity: '88', uid: 11, receivedAt: updatedAt,
            ...(['quarantined', 'quarantine-log-failure'].includes(scenario) ? { issue: { reason: 'size_limit', size: 1048577 } } : {}),
            message: { senderEmail: 'client@example.com', senderName: 'Client', recipient: 'support@example.com',
              subject: 'Complaint', text: 'Please check', attachments: [] }
          }] };
        }
      },
      './tenant-messaging-storage': load('apps/api/src/modules/notifications/tenant-messaging-storage.ts')
    });
    const service = new TenantSupportEmailService(db, {
      assertTenantManagementPermission: async (tenant, user, permission, tx) => {
        assert.equal(tenant, manager.tenantId);
        assert.equal(user, manager.userId);
        assert.equal(permission, 'system:integration:manage');
        if (tx) transactionChecks++;
      }
    }, { configuration: async () => ({ id: 'smtp-config', settings, credentials: {}, revision: { updatedAt } }) }, {});
    await identity.runWithRequestIdentity(manager, async () => {
      if (scenario === 'success' || scenario === 'quarantined') {
        const result = await service.sync();
        assert.equal(result.imported, scenario === 'success' ? 1 : 0);
        assert.equal(result.quarantined, scenario === 'quarantined' ? 1 : 0);
        assert.equal(state.emails.size, 1);
        assert.equal(state.lastUid, 11);
        assert.equal((await service.sync()).imported, 0, 'An already stored UID is not inserted twice');
        assert.equal(state.emails.size, 1);
        assert.equal(state.audits.length, scenario === 'quarantined' ? 1 : 0);
        if (scenario === 'quarantined') {
          assert.equal(state.audits[0].detail.uid, 11); assert.equal(state.audits[0].detail.reason, 'size_limit');
          assert.equal(state.audits[0].tenantId, manager.tenantId);
        }
      } else {
        await assert.rejects(service.sync(), /同步窗口|配置已变化|storage unavailable|quarantine audit unavailable/u);
        assert.equal(state.emails.size, 0, 'A failed transaction does not keep a partial email');
        assert.equal(state.lastUid, 10, 'A failed transaction cannot skip an unread UID');
        assert.equal(state.audits.length, 0);
      }
    });
    assert.equal(mailboxReads, ['success', 'quarantined'].includes(scenario) ? 2 : 1);
    assert.equal(transactionChecks, mailboxReads);
    assert.equal(statements.filter(query => query.sql.includes('SET leaseToken = NULL')).length, mailboxReads);
    assert.ok(statements.every(query => query.values.includes(manager.tenantId)), 'Every storage operation keeps the tenant boundary');
  }
});
