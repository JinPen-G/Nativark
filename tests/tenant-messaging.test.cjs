/** 邮箱/邀请/寄件专项离线检查，纯内存依赖；不读取env、不连库或外部邮箱。 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
const apiRequire = require('node:module').createRequire(path.join(__dirname, '../apps/api/package.json'));

function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(dependencies, name) ? dependencies[name] : apiRequire(name), module, module.exports);
  return module.exports;
}
const nest = require('@nestjs/common');
const { Prisma } = apiRequire('@prisma/client');
const codec = load('apps/api/src/modules/integrations/inbound-mail-codec.ts');
const templates = load('apps/api/src/modules/notifications/tenant-mail-templates.ts');
const identity = load('apps/api/src/common/request-identity.ts');
const smtpFile = 'apps/api/src/modules/integrations/smtp-transport.ts';

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
  const imap = load('apps/api/src/modules/integrations/imap-reader.ts', { 'node:tls': { connect },
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
      if (persist && query.sql.includes("status = 'accepted'")) invitation.status = 'accepted';
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
  await assert.rejects(fixture.service.accept({ token: 'A'.repeat(43), password: 'Test!1234', displayName: 'Client' }), /到期|撤回/u);
  assert.equal(created, 1);
  const denied = invitationsFixture({ invitation: { ...row, status: 'pending' } });
  denied.account.acceptOperatorInvitationInTransaction = async () => { throw new nest.ForbiddenException('inviter no longer authorized'); };
  await assert.rejects(denied.service.accept({ token: 'A'.repeat(43), password: 'Test!1234', displayName: 'Client' }), /no longer authorized/u);
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
  }
  await identity.runWithRequestIdentity({ ...manager, isSaasAdmin: true }, () => assert.rejects(service.list(), /查看权限/u));
});

test('support sync commits mail and cursor together, rejects a lost lease or changed configuration, and preserves duplicate UIDs', async () => {
  for (const scenario of ['success', 'lost-lease', 'changed-config', 'write-failure']) {
    const settings = { receiveEnabled: true };
    const updatedAt = new Date('2026-11-15T00:00:00Z');
    const statements = [];
    const state = { emails: new Set(), lastUid: 10 };
    let mailboxReads = 0;
    let transactionChecks = 0;
    const db = {
      $executeRaw: async query => { statements.push(query); return 1; },
      $queryRaw: async () => [{ id: 'mailbox', uidValidity: '88', lastUid: BigInt(state.lastUid) }],
      $transaction: async callback => {
        const draft = { emails: new Set(state.emails), lastUid: state.lastUid };
        const tx = {
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
      if (scenario === 'success') {
        assert.equal((await service.sync()).imported, 1);
        assert.equal(state.emails.size, 1);
        assert.equal(state.lastUid, 11);
        assert.equal((await service.sync()).imported, 0, 'An already stored UID is not inserted twice');
        assert.equal(state.emails.size, 1);
      } else {
        await assert.rejects(service.sync(), /同步窗口|配置已变化|storage unavailable/u);
        assert.equal(state.emails.size, 0, 'A failed transaction does not keep a partial email');
        assert.equal(state.lastUid, 10, 'A failed transaction cannot skip an unread UID');
      }
    });
    assert.equal(mailboxReads, scenario === 'success' ? 2 : 1);
    assert.equal(transactionChecks, mailboxReads);
    assert.equal(statements.filter(query => query.sql.includes('SET leaseToken = NULL')).length, mailboxReads);
    assert.ok(statements.every(query => query.values.includes(manager.tenantId)), 'Every storage operation keeps the tenant boundary');
  }
});
