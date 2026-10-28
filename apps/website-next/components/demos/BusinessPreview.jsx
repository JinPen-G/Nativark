'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import * as React from 'react';
import { getBusinessStyles } from '../shared/styleNames.js';
import { useLocale } from 'next-intl';
import { assetPath } from '../../lib/site.js';
export function BusinessPreview() {
  const h = React.createElement;
  const css = getBusinessStyles();
  const en = useLocale() === 'en';
  const text = (zh, english) => (en ? english : zh);
  const [view, setView] = React.useState('overview');
  const [mode, setMode] = React.useState('ai');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [enabled, setEnabled] = React.useState({
    inventory: true,
    fulfillment: true,
    finance: false,
    category: true,
    morning: true,
    returns: true,
    report: false,
  });
  const [notice, setNotice] = React.useState('');
  const [replay, setReplay] = React.useState(0);
  const [tab, setTab] = React.useState('dashboard');
  const [orderFilter, setOrderFilter] = React.useState('all');
  const [phase, setPhase] = React.useState(0);
  const [approval, setApproval] = React.useState(false);
  const [workspaceOpen, setWorkspaceOpen] = React.useState(true);
  const conversation = React.useRef(null);
  const cancelApproval = React.useRef(null);
  const reviewAction = React.useRef(null);
  const actionView =
    mode === 'ai' && ['booking', 'fulfillment', 'operations'].includes(view);
  React.useEffect(() => {
    if (conversation.current) conversation.current.scrollTop = 0;
  }, [view, replay, tab]);
  React.useEffect(() => {
    setPhase(0);
    setApproval(false);
    if (!actionView) return;
    const first = setTimeout(() => setPhase(1), 450);
    const ready = setTimeout(() => {
      setPhase(2);
      setApproval(true);
    }, 1700);
    return () => {
      clearTimeout(first);
      clearTimeout(ready);
    };
  }, [view, replay, mode]);
  React.useEffect(() => {
    if (approval)
      cancelApproval.current?.focus({
        preventScroll: true,
      });
  }, [approval]);
  const paths = {
    panel: 'M2 2.5H14V13.5H2ZM5.5 2.5V13.5',
    newChat: 'M8 3V13M3 8H13',
    plugin: 'M6 2H10V5H13V9H10V13H6V10H3V6H6Z',
    clock: 'M8 4V8L11 10M14 8A6 6 0 1 1 2 8A6 6 0 1 1 14 8',
    folderOpen: 'M2 6V3H6L8 5H14V7M2 6H14L12 13H1Z',
    folderClosed: 'M2 13V3H6L8 5H14V13Z',
    search: 'M11 11L14 14M12 7A5 5 0 1 1 2 7A5 5 0 1 1 12 7',
    sliders: 'M2 4H14M2 12H14M5 2V6M11 10V14',
    user: 'M3 14C3 9 13 9 13 14M11 5A3 3 0 1 1 5 5A3 3 0 1 1 11 5',
    shield: 'M8 1L14 3V8C14 11 10 14 8 15C6 14 2 11 2 8V3ZM5 8L7 10L11 6',
    chevron: 'M5 3L10 8L5 13',
    down: 'M4 6L8 10L12 6',
    arrowUp: 'M8 14V2M3 7L8 2L13 7',
    check: 'M3 8L6.5 11.5L13 5',
  };
  const icon = (name) =>
    h(
      'svg',
      {
        key: name,
        'data-preview-icon': true,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.15,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      h('path', {
        d: paths[name] || paths.panel,
      }),
    );
  const scenes = {
    overview: {
      title: text('认识 Rental OS', 'Meet Rental OS'),
      question: text(
        '我能怎样通过对话经营租赁业务？',
        'How can I run my rental business through conversation?',
      ),
      intro: text(
        'Rental OS 是 AI Native 的租赁业务平台。说出你的经营目标，AI 将理解业务上下文，协调不同任务，并通过 Rental Core 连接预约、库存、履约与结算。',
        'Rental OS is an AI Native rental platform. Describe your goal: AI understands the business context, coordinates work, and connects bookings, inventory, fulfillment and settlement through Rental Core.',
      ),
      lead: text(
        '不同业务，可以交给不同的对话：',
        'Keep different work in focused conversations:',
      ),
      items: [
        [
          text('经营与协同', 'Operations'),
          text(
            '查看经营动态、梳理待办，协调门店与团队。',
            'Review activity, prioritize work and coordinate locations.',
          ),
        ],
        [
          text('预约与库存', 'Bookings & inventory'),
          text(
            '理解客户需求，查询可租资源，准备预约方案。',
            'Understand requests, check availability and prepare booking plans.',
          ),
        ],
        [
          text('订单与履约', 'Orders & fulfillment'),
          text(
            '串联交付、租用、归还与验收，跟进处理进度。',
            'Coordinate handover, rental, return and inspection.',
          ),
        ],
        [
          text('财务与结算', 'Finance & settlement'),
          text(
            '核对应收与押金，整理结算事项和业务依据。',
            'Review receivables, deposits and supporting records.',
          ),
        ],
        [
          text('插件与自动化', 'Plugins & automation'),
          text(
            '扩展业务能力，让重复工作按计划推进。',
            'Extend capabilities and schedule recurring work.',
          ),
        ],
      ],
      more: text(
        '对话驱动业务，也可随时切换业务后台。重要操作仍需权限与确认。',
        'Conversation drives the work. Switch to the business console anytime; sensitive actions still require permission and confirmation.',
      ),
    },
    booking: {
      title: text('预约与库存', 'Bookings & inventory'),
      question: text(
        '周末客户需要两套摄影设备，帮我安排一下。',
        'A customer needs two camera kits this weekend. Help me plan it.',
      ),
      intro: text(
        '我会先核对租期、可用库存与配件，再整理预约方案。以下是示例流程，尚未锁定库存或创建真实订单。',
        'I will check the dates, available stock and accessories, then prepare a booking plan. This is a sample flow: no stock is reserved and no real order is created.',
      ),
      lead: text('预约方案 · 演示数据', 'Booking plan · Sample data'),
      items: [
        [
          text('理解需求', 'Understand'),
          text(
            '周六取件、周日归还，两套机身与标准镜头。',
            'Saturday pickup, Sunday return; two bodies and standard lenses.',
          ),
        ],
        [
          text('核对库存', 'Check stock'),
          text(
            '查看租期占用、设备状态与配件完整性。',
            'Check date conflicts, asset condition and accessories.',
          ),
        ],
        [
          text('整理方案', 'Prepare'),
          text(
            '关联客户、租期与设备，形成待确认预约草稿。',
            'Link the customer, dates and kits in a draft for review.',
          ),
        ],
      ],
      more: text(
        '下一步：由你核对并确认，再通过正式业务流程提交。',
        'Next: review and confirm before submitting through the business workflow.',
      ),
    },
    fulfillment: {
      title: text('订单与履约', 'Orders & fulfillment'),
      question: text(
        '整理今天的交付和归还，告诉我先处理什么。',
        'Review today’s handovers and returns. What should we do first?',
      ),
      intro: text(
        '我已按交付时间、归还安排与待验收事项整理优先级。每个事项都关联原订单，团队可以继续在对话里推进，也能回到业务页面处理。',
        'Here is a sample priority list based on handover times, scheduled returns and inspections. Each item links back to its order, so your team can continue in conversation or use the console.',
      ),
      lead: text(
        '今日履约安排 · 演示数据',
        'Today’s fulfillment · Sample data',
      ),
      items: [
        [
          text('先交付', 'Handovers first'),
          text(
            '上午摄影设备订单：核对配件与交接清单。',
            'Morning camera order: verify accessories and the handover checklist.',
          ),
        ],
        [
          text('再跟进', 'Follow up'),
          text(
            '下午露营装备归还：准备验收与清洁安排。',
            'Afternoon camping return: prepare inspection and cleaning.',
          ),
        ],
        [
          text('留意异常', 'Review exceptions'),
          text(
            '待验收设备先确认状态，再进入可租库存。',
            'Inspect returned assets before releasing them for rental.',
          ),
        ],
      ],
      more: text(
        '业务状态以 Rental Core 的记录与执行回执为准。',
        'Rental Core records and execution receipts remain the source of truth.',
      ),
    },
    operations: {
      title: text('门店与团队协同', 'Locations & teams'),
      question: text(
        '帮我梳理各门店的待办，把工作安排清楚。',
        'Organize work across our locations and teams.',
      ),
      intro: text(
        '我会在当前经营空间和授权范围内，汇总任务、识别依赖，并准备协同安排。不同对话各自跟进事务，共享同一套业务上下文。',
        'Within the current workspace and permissions, I can bring work together, identify dependencies and prepare a coordination plan. Focused conversations share the same business context.',
      ),
      lead: text(
        '协同安排 · 流程演示',
        'Coordination plan · Illustrative flow',
      ),
      items: [
        [
          text('门店待办', 'Location tasks'),
          text(
            '按交付、归还与维护分类，明确处理顺序。',
            'Group handovers, returns and maintenance by priority.',
          ),
        ],
        [
          text('团队分工', 'Team roles'),
          text(
            '关联负责人和业务对象，保留处理过程。',
            'Associate owners with business records and retain the work history.',
          ),
        ],
        [
          text('跨品类经营', 'Rental categories'),
          text(
            '通过 Rental Core 的品类能力适配新的租赁场景。',
            'Extend rental scenarios with Rental Core category capabilities.',
          ),
        ],
      ],
      more: text(
        '你决定目标和边界，AI 协调推进，团队随时接手。',
        'You set the goal and boundaries. AI coordinates; your team stays in control.',
      ),
    },
    finance: {
      title: text('财务与结算', 'Finance & settlement'),
      question: text(
        '哪些订单还需要结算？把依据一起整理好。',
        'Which orders need settlement? Include the supporting records.',
      ),
      intro: text(
        '我会关联订单、支付、押金与归还记录，区分待核对和待处理事项。金额与结算结果以正式业务记录为准，不凭对话推算。',
        'I will connect order, payment, deposit and return records, separating items to review from actions to take. Amounts and settlement outcomes come from business records, not estimates in chat.',
      ),
      lead: text(
        '结算核对 · 流程演示',
        'Settlement review · Illustrative flow',
      ),
      items: [
        [
          text('核对应收', 'Receivables'),
          text(
            '读取订单账单与已有支付记录，整理差异。',
            'Compare the order bill with recorded payments.',
          ),
        ],
        [
          text('处理押金', 'Deposits'),
          text(
            '关联归还验收结果，准备待审批事项。',
            'Review return inspections and prepare items for approval.',
          ),
        ],
        [
          text('保留依据', 'Traceability'),
          text(
            '结算事项回到原订单和收据，可随时核查。',
            'Keep each settlement linked to its order and receipt.',
          ),
        ],
      ],
      more: text(
        '退款和资金操作需要相应权限与确认，不会在此演示中执行。',
        'Refunds and money movements require permission and confirmation; this demo executes neither.',
      ),
    },
  };
  const titles = {
    plugins: text('插件', 'Plugins'),
    automation: text('自动化任务', 'Automation'),
    new: text('新对话', 'New conversation'),
  };
  const scene = scenes[view] || scenes.overview;
  const choose = (key) => {
    setMode('ai');
    setView(key);
    setNotice('');
    setMenuOpen(false);
    setApproval(false);
    setWorkspaceOpen(true);
  };
  const switchMode = (next) => {
    setMode(next);
    setApproval(false);
    setMenuOpen(false);
    setNotice('');
  };
  const toggle = (key) => {
    setEnabled((previous) => ({
      ...previous,
      [key]: !previous[key],
    }));
    setNotice(
      text(
        '已更新演示配置，不影响真实业务。',
        'Demo configuration updated. Real business is unaffected.',
      ),
    );
  };
  const button = (className, label, onClick, extra = {}) =>
    h(
      'button',
      {
        type: 'button',
        className: className + ' rentalos-preview-control',
        onClick,
        ...extra,
      },
      label,
    );
  const nav = (key, label, name, className = css.navRow) =>
    button(
      className + (view === key ? ' ' + css.selected : ''),
      [
        className !== css.sessionRow && icon(name),
        h(
          'span',
          {
            key: 'label',
            className:
              className === css.newSession ? undefined : css.sessionTitle,
          },
          label,
        ),
      ],
      () => choose(key),
      {
        'aria-pressed': view === key,
        'data-preview-view': key,
        key,
      },
    );
  const lights = () =>
    h(
      'div',
      {
        className: css.trafficLights,
      },
      h('i'),
      h('i'),
      h('i'),
    );
  const rows =
    view === 'plugins'
      ? [
          [
            'inventory',
            'folderOpen',
            text('预约与库存', 'Bookings & inventory'),
            text(
              '连接可租日历、库存与预约草稿。',
              'Connect availability, inventory and booking drafts.',
            ),
          ],
          [
            'fulfillment',
            'panel',
            text('订单与履约', 'Orders & fulfillment'),
            text(
              '连接交付、归还与验收记录。',
              'Connect handovers, returns and inspections.',
            ),
          ],
          [
            'finance',
            'shield',
            text('财务与结算', 'Finance & settlement'),
            text(
              '核对账单、支付与结算依据。',
              'Review bills, payments and settlement records.',
            ),
          ],
          [
            'category',
            'plugin',
            'Rental Core',
            text(
              '按业务需要扩展租赁品类能力。',
              'Extend category capabilities for your rental business.',
            ),
          ],
        ]
      : [
          [
            'morning',
            'clock',
            text('晨间经营简报', 'Morning operations brief'),
            text(
              '每天 09:00 · 汇总经营动态与今日待办',
              'Daily at 09:00 · Activity and today’s priorities',
            ),
          ],
          [
            'returns',
            'clock',
            text('归还与验收跟进', 'Return & inspection follow-up'),
            text(
              '每天 16:00 · 整理待归还与待验收事项',
              'Daily at 16:00 · Review due returns and inspections',
            ),
          ],
          [
            'report',
            'clock',
            text('每周经营复盘', 'Weekly business review'),
            text(
              '每周五 17:00 · 整理经营变化与待决策事项',
              'Fridays at 17:00 · Review changes and decisions',
            ),
          ],
        ];
  const listContent = () =>
    h(
      'div',
      {
        className: css.assistantMessage,
      },
      h(
        'p',
        null,
        view === 'plugins'
          ? text(
              '把业务能力连接到对话。AI 按你的目标调用能力，仍遵循原有权限与确认流程。',
              'Connect business capabilities to conversation. AI coordinates them toward your goal, within existing permissions and confirmation flows.',
            )
          : text(
              '把重复工作交给计划。AI 按时整理信息、准备处理建议，需要确认的业务动作留给你决定。',
              'Put recurring work on a schedule. AI prepares information and recommendations; actions requiring confirmation stay with you.',
            ),
      ),
      h(
        'p',
        {
          className: 'rentalos-preview-muted',
        },
        text(
          '交互演示 · 以下配置与数据不会影响真实业务',
          'Interactive demo · Configuration and data do not affect real business',
        ),
      ),
      h(
        'div',
        {
          className: 'rentalos-preview-rows',
        },
        ...rows.map(([key, name, title, description]) =>
          h(
            'div',
            {
              key,
              className: 'rentalos-preview-row',
            },
            icon(name),
            h(
              'div',
              {
                className: 'rentalos-preview-row-copy',
              },
              h('strong', null, title),
              h('p', null, description),
            ),
            button(
              'rentalos-preview-state',
              enabled[key]
                ? text('已启用', 'Enabled')
                : text('未启用', 'Disabled'),
              () => toggle(key),
              {
                'aria-pressed': !!enabled[key],
                'aria-label':
                  (enabled[key]
                    ? text('停用 ', 'Disable ')
                    : text('启用 ', 'Enable ')) + title,
              },
            ),
            view === 'automation' &&
              button(
                'rentalos-preview-run',
                text('运行演示', 'Run demo'),
                () =>
                  setNotice(
                    text(
                      '演示结果：已整理待办与建议，等待人工确认。未执行真实任务。',
                      'Demo result: priorities and recommendations prepared for review. No real task ran.',
                    ),
                  ),
                {
                  disabled: !enabled[key],
                },
              ),
          ),
        ),
      ),
    );
  const businessMenu = [
    ['dashboard', 'panel', 'Dashboard'],
    ['orders', 'folderOpen', text('订单管理', 'Orders')],
    ['inventory', 'folderClosed', text('库存管理', 'Inventory')],
    ['members', 'user', text('会员管理', 'Members')],
    ['locations', 'panel', text('门店管理', 'Locations')],
  ];
  const businessTitle =
    businessMenu.find(([key]) => key === tab)?.[2] || 'Dashboard';
  const businessContent = () => {
    const tables = {
      orders: {
        headers: [
          text('订单编号', 'Order'),
          text('客户 / 品类', 'Customer / Category'),
          text('租金', 'Rental'),
          text('状态', 'Status'),
        ],
        rows: [
          [
            'RO-DEMO-001',
            text('林先生 · 摄影器材', 'Alex · Camera kit'),
            '¥1,200',
            text('待交付', 'Awaiting handover'),
          ],
          [
            'RO-DEMO-002',
            text('张女士 · 露营装备', 'Sam · Camping kit'),
            '¥680',
            text('租用中', 'On rent'),
          ],
          [
            'RO-DEMO-003',
            text('陈先生 · 场地租赁', 'Chris · Venue rental'),
            '¥1,600',
            text('待确认', 'For review'),
          ],
        ],
      },
      inventory: {
        headers: [
          text('资源名称', 'Resource'),
          text('品类', 'Category'),
          text('所属门店', 'Location'),
          text('状态', 'Status'),
        ],
        rows: [
          [
            text('摄影套装 A', 'Camera kit A'),
            text('摄影器材', 'Camera equipment'),
            text('中心店', 'Central'),
            text('可预约', 'Available'),
          ],
          [
            text('露营套装 B', 'Camping kit B'),
            text('露营装备', 'Camping equipment'),
            text('北区店', 'North'),
            text('租用中', 'On rent'),
          ],
          [
            text('多功能场地', 'Multipurpose venue'),
            text('场地租赁', 'Venue rental'),
            text('中心店', 'Central'),
            text('按时段预约', 'Time-slot booking'),
          ],
        ],
      },
      members: {
        headers: [
          text('会员', 'Member'),
          text('会员编号', 'Member ID'),
          text('累计订单', 'Orders'),
          text('状态', 'Status'),
        ],
        rows: [
          [text('林先生', 'Alex'), 'MB-DEMO-001', '8', text('正常', 'Active')],
          [text('张女士', 'Sam'), 'MB-DEMO-002', '5', text('正常', 'Active')],
          [text('陈先生', 'Chris'), 'MB-DEMO-003', '3', text('正常', 'Active')],
        ],
      },
      locations: {
        headers: [
          text('门店', 'Location'),
          text('负责人', 'Owner'),
          text('今日待办', 'Today’s tasks'),
          text('状态', 'Status'),
        ],
        rows: [
          [
            text('中心店', 'Central'),
            text('小林', 'Lin'),
            '4',
            text('营业中', 'Open'),
          ],
          [
            text('北区店', 'North'),
            text('小周', 'Zhou'),
            '3',
            text('营业中', 'Open'),
          ],
        ],
      },
    };
    const table = tables[tab];
    return h(
      'div',
      {
        className: 'rentalos-business-page',
      },
      h(
        'div',
        {
          className: 'rentalos-business-heading',
        },
        h(
          'div',
          null,
          h('h3', null, businessTitle),
          h(
            'p',
            null,
            text('租赁业务 / ', 'Rental operations / '),
            businessTitle,
          ),
        ),
        h(
          'span',
          {
            className: 'rentalos-preview-muted',
          },
          text('示例数据', 'Sample data'),
        ),
      ),
      tab === 'dashboard'
        ? h(
            React.Fragment,
            null,
            h(
              'div',
              {
                className: 'rentalos-business-summary',
              },
              ...[
                [text('今日预约', 'Today’s bookings'), '12'],
                [text('待交付', 'Handovers due'), '4'],
                [text('待归还', 'Returns due'), '7'],
              ].map(([label, value]) =>
                h(
                  'div',
                  {
                    key: label,
                  },
                  h('span', null, label),
                  h('strong', null, value),
                ),
              ),
            ),
            h(
              'section',
              {
                className: 'rentalos-business-section',
              },
              h('h4', null, text('经营待办', 'Operations to-do')),
              ...[
                [
                  text(
                    '核对上午摄影设备交接',
                    'Review morning camera handover',
                  ),
                  text('中心店 · 小林', 'Central · Lin'),
                  '09:30',
                ],
                [
                  text(
                    '安排露营装备归还验收',
                    'Arrange camping return inspection',
                  ),
                  text('北区店 · 小周', 'North · Zhou'),
                  '16:00',
                ],
                [
                  text('核对待结算订单', 'Review orders for settlement'),
                  text('财务团队', 'Finance team'),
                  '17:00',
                ],
              ].map(([title, owner, time]) =>
                h(
                  'div',
                  {
                    className: 'rentalos-business-todo',
                    key: title,
                  },
                  icon('clock'),
                  h('div', null, h('strong', null, title), h('p', null, owner)),
                  h('span', null, time),
                ),
              ),
            ),
            button(
              'rentalos-preview-inline',
              text('查看全部订单', 'View all orders'),
              () => setTab('orders'),
            ),
          )
        : h(
            React.Fragment,
            null,
            tab === 'orders' &&
              h(
                'div',
                {
                  className: 'rentalos-preview-tabs',
                  role: 'group',
                  'aria-label': text('订单状态筛选', 'Filter orders'),
                },
                ...[
                  ['all', text('全部', 'All')],
                  ['handover', text('待交付', 'Awaiting handover')],
                  ['rental', text('租用中', 'On rent')],
                ].map(([key, label]) =>
                  button('', label, () => setOrderFilter(key), {
                    'aria-pressed': orderFilter === key,
                    key,
                  }),
                ),
              ),
            h(
              'div',
              {
                className: 'rentalos-preview-table-wrap',
              },
              h(
                'table',
                {
                  className: 'rentalos-preview-table',
                },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    ...table.headers.map((value) =>
                      h(
                        'th',
                        {
                          key: value,
                          scope: 'col',
                        },
                        value,
                      ),
                    ),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  ...table.rows
                    .filter(
                      (row, index) =>
                        tab !== 'orders' ||
                        orderFilter === 'all' ||
                        index === (orderFilter === 'handover' ? 0 : 1),
                    )
                    .map((row, index) =>
                      h(
                        'tr',
                        {
                          key: index,
                        },
                        ...row.map((value, column) =>
                          h(
                            'td',
                            {
                              key: column,
                            },
                            column === row.length - 1
                              ? h(
                                  'span',
                                  {
                                    className: 'rentalos-business-status',
                                  },
                                  value,
                                )
                              : value,
                          ),
                        ),
                      ),
                    ),
                ),
              ),
            ),
            h(
              'p',
              {
                className: 'rentalos-preview-muted',
              },
              text(
                '管理界面演示，数据与真实业务无关。',
                'Console preview. Records are illustrative only.',
              ),
            ),
          ),
    );
  };
  const chatContent = () =>
    h(
      React.Fragment,
      null,
      h(
        'div',
        {
          className: css.userMessage,
        },
        scene.question,
      ),
      h(
        'div',
        {
          className: css.analysisSummary,
        },
        h(
          'span',
          null,
          text('业务上下文 · 流程演示', 'Business context · Illustrative flow'),
        ),
        icon('chevron'),
      ),
      h(
        'div',
        {
          className: css.assistantMessage,
        },
        h('p', null, scene.intro),
        h('p', null, scene.lead),
        h(
          'ol',
          null,
          ...scene.items.map(([title, description]) =>
            h(
              'li',
              {
                key: title,
              },
              h('strong', null, title),
              ' — ',
              description,
            ),
          ),
        ),
        h(
          'p',
          {
            className: css.moreMessage,
          },
          scene.more,
        ),
      ),
    );
  const actions = {
    booking: {
      question: text(
        '给林先生安排周末两套摄影设备，报价合适就准备预约。',
        'Prepare a weekend booking for Alex: two camera kits, with a quote for review.',
      ),
      working: text(
        '我来核对租期与库存，整理报价和预约资料。',
        'I’ll check the dates and stock, then prepare the quote and booking details.',
      ),
      ready: text(
        '两套设备的预约资料与报价已整理在右侧。核对后确认，我就继续提交预约。',
        'The booking details and quote are ready on the right. Review them and confirm to submit.',
      ),
      done: text(
        '已按你的确认提交预约，并生成预约记录。你可以继续安排交付。',
        'Your confirmation has been applied: the booking record is ready for handover planning.',
      ),
      steps: [
        text(
          '核对客户、租期与可租库存',
          'Check customer, dates and availability',
        ),
        text('整理设备、配件与租金报价', 'Prepare kits, accessories and quote'),
        text('生成待确认的预约资料', 'Prepare the booking for confirmation'),
      ],
      title: text('预约资料与报价', 'Booking details & quote'),
      confirm: text('确认提交预约', 'Confirm booking'),
      consequence: text(
        '将按右侧资料提交两套摄影设备的预约，关联客户、租期与示例报价。',
        'Submit the two camera kits using the customer, dates and sample quote shown in the workspace.',
      ),
      receipt: 'BK-DEMO-026',
      receiptLabel: text('预约记录', 'Booking record'),
    },
    fulfillment: {
      question: text(
        '把今天待交付的订单安排好，生成交接清单并分派负责人。',
        'Prepare today’s handovers, generate the checklists and assign the team.',
      ),
      working: text(
        '我来核对待交付订单、设备和门店人员，准备交接安排。',
        'I’ll check the orders, equipment and location team, then prepare the handovers.',
      ),
      ready: text(
        '两笔交付已排好顺序，交接清单和负责人在右侧。确认后，我会生成对应的履约任务。',
        'Two handovers are planned. Checklists and owners are ready on the right. Confirm to create the fulfillment tasks.',
      ),
      done: text(
        '已生成两项履约任务，交接清单与订单关联，门店负责人可继续处理。',
        'Two fulfillment tasks are ready, with checklists linked to their orders for the location team.',
      ),
      steps: [
        text('读取待交付订单与设备清单', 'Read orders and equipment lists'),
        text('核对交接时间与门店负责人', 'Check handover times and owners'),
        text('准备履约任务与交接清单', 'Prepare tasks and checklists'),
      ],
      title: text('交付安排与交接清单', 'Handovers & checklists'),
      confirm: text('确认创建履约任务', 'Confirm fulfillment tasks'),
      consequence: text(
        '将为两笔订单生成交接任务并分派负责人。实际交付完成仍需门店核验。',
        'Create handover tasks for two orders and assign their owners. Physical handover still requires the location team’s verification.',
      ),
      receipt: 'FL-DEMO-018',
      receiptLabel: text('履约任务', 'Fulfillment tasks'),
    },
    operations: {
      question: text(
        '把周末两家门店的交付和归还安排好，分派给各自负责人。',
        'Plan the weekend handovers and returns at both locations, and assign the owners.',
      ),
      working: text(
        '我来汇总两家门店的业务安排，检查时间冲突，再准备团队分工。',
        'I’ll review both locations, check for timing conflicts and prepare the team assignments.',
      ),
      ready: text(
        '两家门店的分工已整理在右侧，交付、归还和验收各有负责人。确认后即可分派。',
        'The plan is ready on the right, with owners for handover, return and inspection. Confirm to assign the work.',
      ),
      done: text(
        '已分派三项协同任务，各门店按各自的业务范围处理，进度可回到当前对话跟进。',
        'Three tasks have been assigned within each location’s business scope. Continue tracking them in this conversation.',
      ),
      steps: [
        text(
          '汇总授权范围内的门店待办',
          'Review tasks within the permitted locations',
        ),
        text('检查时间与团队分工', 'Check timings and team assignments'),
        text('生成跨门店协同安排', 'Prepare the coordination plan'),
      ],
      title: text('门店协同安排', 'Location coordination plan'),
      confirm: text('确认分派任务', 'Confirm assignments'),
      consequence: text(
        '将把右侧三项任务分派给对应门店负责人，保留订单关联和处理记录。',
        'Assign the three tasks to their location owners, keeping the associated orders and work history.',
      ),
      receipt: 'OP-DEMO-012',
      receiptLabel: text('协同安排', 'Coordination plan'),
    },
  };
  const action = actions[view];
  const closeApproval = () => {
    setApproval(false);
    reviewAction.current?.focus({
      preventScroll: true,
    });
  };
  const completeAction = () => {
    if (phase !== 2) return;
    setPhase(3);
    setApproval(false);
    setNotice(
      text(
        '演示执行完成，已生成示例回执。未写入真实业务。',
        'Demo completed with a sample receipt. No real business record was changed.',
      ),
    );
    reviewAction.current?.focus({
      preventScroll: true,
    });
  };
  const actionChat = () =>
    h(
      React.Fragment,
      null,
      h(
        'div',
        {
          className: css.userMessage,
        },
        action.question,
      ),
      h(
        'div',
        {
          className: css.analysisSummary,
        },
        icon(phase >= 2 ? 'check' : 'clock'),
        h(
          'span',
          {
            role: 'status',
          },
          phase === 3
            ? text('已确认 · 演示执行完成', 'Confirmed · Demo complete')
            : phase >= 2
              ? text('准备就绪，等待你的确认', 'Ready for your confirmation')
              : text('正在协调业务能力', 'Coordinating business capabilities'),
        ),
      ),
      h(
        'div',
        {
          className: css.assistantMessage,
        },
        h(
          'p',
          null,
          phase === 3
            ? action.done
            : phase >= 2
              ? action.ready
              : action.working,
        ),
        h(
          'ol',
          {
            className: 'rentalos-agent-steps',
          },
          ...action.steps.map((step, index) =>
            h(
              'li',
              {
                key: step,
                'data-step-state':
                  phase >= 2 || phase > index ? 'done' : 'pending',
              },
              icon(phase >= 2 || phase > index ? 'check' : 'clock'),
              h('span', null, step),
            ),
          ),
        ),
        phase >= 2 &&
          h(
            'p',
            {
              className: 'rentalos-preview-muted',
            },
            phase === 3
              ? text(
                  '一句话发起，确认后执行，结果留在工作区。',
                  'One request, one confirmation. Results stay in the workspace.',
                )
              : text(
                  '资料已准备好，你不必再到后台逐项填写。',
                  'The details are prepared; no need to fill them in again in the console.',
                ),
          ),
        button(
          'rentalos-preview-inline rentalos-agent-mobile-review',
          text('查看 Agent 工作区', 'View Agent workspace'),
          () => setWorkspaceOpen(true),
        ),
      ),
    );
  const facts = (entries) =>
    h(
      'dl',
      {
        className: 'rentalos-agent-facts',
      },
      ...entries.map(([label, value]) =>
        h(
          'div',
          {
            key: label,
          },
          h('dt', null, label),
          h('dd', null, value),
        ),
      ),
    );
  const workItem = (title, detail, owner, time) =>
    h(
      'div',
      {
        className: 'rentalos-agent-work-item',
        key: title,
      },
      h('strong', null, title),
      h('p', null, detail),
      h(
        'div',
        {
          className: 'rentalos-agent-assignment',
        },
        h('span', null, owner),
        h('span', null, time),
      ),
    );
  const workspace = () =>
    h(
      'section',
      {
        className: 'rentalos-agent-workspace',
        'aria-label': text('Agent 工作区', 'Agent workspace'),
        'data-workspace-open': workspaceOpen ? 'true' : 'false',
      },
      h(
        'div',
        {
          className: 'rentalos-agent-workspace-bar',
        },
        h('span', null, text('Agent 工作区', 'Agent workspace')),
        button('', text('收起', 'Hide'), () => setWorkspaceOpen(false), {
          'aria-label': text('收起 Agent 工作区', 'Hide Agent workspace'),
        }),
      ),
      h(
        'div',
        {
          className: 'rentalos-agent-output',
        },
        h(
          'div',
          {
            className: 'rentalos-agent-document-heading',
          },
          icon(phase === 3 ? 'check' : 'folderOpen'),
          h('strong', null, action.title),
        ),
        h(
          'p',
          {
            className: 'rentalos-preview-muted',
          },
          text('示例数据 · ', 'Sample data · '),
          phase === 3
            ? text('已确认执行', 'Confirmed')
            : phase >= 2
              ? text('待确认', 'For review')
              : text('正在准备', 'Preparing'),
        ),
        view === 'booking'
          ? h(
              React.Fragment,
              null,
              facts([
                [text('客户', 'Customer'), text('林先生', 'Alex')],
                [
                  text('租期', 'Rental period'),
                  text('周六 09:00 — 周日 18:00', 'Sat 09:00 — Sun 18:00'),
                ],
                [
                  text('交付方式', 'Handover'),
                  text(
                    '中心店自提 / 到店归还',
                    'Central pickup / In-store return',
                  ),
                ],
              ]),
              h(
                'div',
                {
                  className: 'rentalos-agent-section',
                },
                h('strong', null, text('摄影设备套装 × 2', 'Camera kit × 2')),
                h(
                  'p',
                  null,
                  text(
                    '机身、标准镜头、电池、存储卡',
                    'Body, standard lens, batteries and memory card',
                  ),
                ),
              ),
              h(
                'div',
                {
                  className: 'rentalos-agent-section',
                },
                h('strong', null, text('报价明细', 'Quote breakdown')),
                facts([
                  [
                    text('单价', 'Rate'),
                    text('¥300 / 套 / 天', 'CNY 300 / kit / day'),
                  ],
                  [
                    text('租金 · 2 套 × 2 天', 'Rental · 2 kits × 2 days'),
                    '¥1,200',
                  ],
                  [text('可退押金', 'Refundable deposit'), '¥2,000'],
                  [text('待支付合计', 'Total payable'), '¥3,200'],
                ]),
                h(
                  'p',
                  {
                    className: 'rentalos-preview-muted',
                  },
                  text(
                    '示例报价，非实际账单。',
                    'Sample quote, not an actual bill.',
                  ),
                ),
              ),
            )
          : view === 'fulfillment'
            ? h(
                React.Fragment,
                null,
                workItem(
                  'RO-DEMO-018',
                  text(
                    '摄影套装 × 2 · 中心店自提',
                    '2 camera kits · Central pickup',
                  ),
                  text('负责人：小林', 'Owner: Lin'),
                  '09:30',
                ),
                workItem(
                  'RO-DEMO-019',
                  text(
                    '露营套装 × 3 · 北区店配送',
                    '3 camping kits · North delivery',
                  ),
                  text('负责人：小周', 'Owner: Zhou'),
                  '11:00',
                ),
                h(
                  'div',
                  {
                    className: 'rentalos-agent-section',
                  },
                  h(
                    'strong',
                    null,
                    text('交接清单已备好', 'Checklists prepared'),
                  ),
                  h(
                    'p',
                    null,
                    text(
                      '设备与配件核对、状态拍照、交接签收。',
                      'Equipment and accessories, condition photos, handover acknowledgment.',
                    ),
                  ),
                ),
              )
            : h(
                React.Fragment,
                null,
                workItem(
                  text('中心店 · 周六交付', 'Central · Saturday handover'),
                  text(
                    '关联 2 笔预约，提前核对设备。',
                    '2 linked bookings; prepare equipment in advance.',
                  ),
                  text('负责人：小林', 'Owner: Lin'),
                  text('周六 09:00', 'Sat 09:00'),
                ),
                workItem(
                  text('北区店 · 周日归还', 'North · Sunday returns'),
                  text(
                    '整理归还清单，安排到店接收。',
                    'Prepare the return list and receiving team.',
                  ),
                  text('负责人：小周', 'Owner: Zhou'),
                  text('周日 16:00', 'Sun 16:00'),
                ),
                workItem(
                  text('北区店 · 归还验收', 'North · Return inspection'),
                  text(
                    '归还后验收，核对状态后释放库存。',
                    'Inspect returns before releasing inventory.',
                  ),
                  text('负责人：小陈', 'Owner: Chen'),
                  text('归还后', 'After return'),
                ),
              ),
        phase === 3 &&
          h(
            'div',
            {
              className: 'rentalos-agent-receipt',
              role: 'status',
            },
            icon('check'),
            h(
              'div',
              null,
              h('strong', null, text('演示执行回执', 'Demo execution receipt')),
              h('p', null, action.receiptLabel, ' · ', action.receipt),
            ),
          ),
      ),
      h(
        'div',
        {
          className: 'rentalos-agent-footer',
        },
        button(
          'rentalos-agent-primary',
          phase === 3
            ? text('已确认 · 查看回执', 'Confirmed · Receipt above')
            : phase < 2
              ? text('正在准备资料…', 'Preparing details…')
              : action.confirm,
          () => setApproval(true),
          {
            ref: reviewAction,
            disabled: phase !== 2,
          },
        ),
        h(
          'span',
          null,
          text('仅演示，不会提交真实业务', 'Demo only. No real submission.'),
        ),
      ),
    );
  const confirmation = () =>
    h(
      'div',
      {
        className: 'rentalos-agent-confirm-layer',
      },
      h(
        'section',
        {
          className: 'rentalos-agent-confirm',
          role: 'dialog',
          'aria-label': action.confirm,
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              closeApproval();
            }
          },
        },
        h(
          'div',
          {
            className: 'rentalos-agent-document-heading',
          },
          icon('shield'),
          h('strong', null, text('确认后继续执行', 'Confirm to continue')),
        ),
        h('p', null, action.consequence),
        h(
          'p',
          {
            className: 'rentalos-preview-muted',
          },
          view === 'booking'
            ? text(
                '2 套 · 2 天 · 租金 ¥1,200 · 押金 ¥2,000',
                '2 kits · 2 days · Rental CNY 1,200 · Deposit CNY 2,000',
              )
            : view === 'fulfillment'
              ? text(
                  '2 笔订单 · 2 项履约任务',
                  '2 orders · 2 fulfillment tasks',
                )
              : text('2 家门店 · 3 项协同任务', '2 locations · 3 assignments'),
        ),
        h(
          'div',
          {
            className: 'rentalos-agent-confirm-actions',
          },
          button(
            'rentalos-preview-inline',
            text('返回核对', 'Review details'),
            closeApproval,
            {
              ref: cancelApproval,
            },
          ),
          button('rentalos-agent-primary', action.confirm, completeAction),
        ),
        h(
          'small',
          null,
          text(
            '交互演示：确认仅生成示例回执。',
            'Interactive demo: confirmation produces a sample receipt only.',
          ),
        ),
      ),
    );
  const composer = h(
    'div',
    {
      className: css.composerDock,
    },
    h(
      'div',
      {
        className: css.composer,
      },
      h(
        'div',
        {
          className: css.placeholder,
        },
        text(
          '说出经营目标，连接业务、协调任务、推进执行。',
          'Describe your goal. Connect business, coordinate tasks, move work forward.',
        ),
      ),
      h(
        'div',
        {
          className: css.composerToolbar,
        },
        h(
          'div',
          {
            className: css.composerLeft,
          },
          button(css.add, icon('newChat'), () => choose('new'), {
            'aria-label': text('新对话', 'New conversation'),
          }),
          h(
            'span',
            {
              className: css.permission,
            },
            icon('shield'),
            h('span', null, text('操作需确认', 'Confirm actions')),
          ),
        ),
        h(
          'div',
          {
            className: css.composerRight,
          },
          h(
            'span',
            {
              className: css.model,
            },
            h(
              'span',
              null,
              'DeepSeek-V41-Flash ',
              h(
                'span',
                {
                  className: css.modelEffort,
                },
                'High',
              ),
            ),
            icon('down'),
          ),
          button(
            css.send,
            icon('arrowUp'),
            () => {
              setReplay(replay + 1);
              setNotice('');
            },
            {
              'aria-label': text('重播当前演示', 'Replay current demo'),
            },
          ),
        ),
      ),
    ),
  );
  const chatPanel = h(
    'div',
    {
      className: 'rentalos-agent-chat',
    },
    h(
      'div',
      {
        className: css.conversation,
        ref: conversation,
      },
      h(
        'div',
        {
          className: css.transcript + ' rentalos-preview-transcript',
          key: view + replay + tab,
        },
        actionView
          ? actionChat()
          : view === 'plugins' || view === 'automation'
            ? listContent()
            : view === 'new'
              ? h(
                  'div',
                  {
                    className: css.assistantMessage,
                  },
                  h(
                    'p',
                    null,
                    text(
                      '今天，你想推进什么业务？',
                      'What would you like to move forward today?',
                    ),
                  ),
                  h(
                    'p',
                    null,
                    text(
                      '选择一个场景，查看 AI 如何理解目标、连接业务并准备下一步。',
                      'Choose a scenario to see how AI understands a goal, connects records and prepares the next step.',
                    ),
                  ),
                  ...['booking', 'fulfillment', 'operations', 'finance'].map(
                    (key) =>
                      button(
                        'rentalos-preview-prompt',
                        actions[key]?.question || scenes[key].question,
                        () => choose(key),
                        {
                          key,
                        },
                      ),
                  ),
                )
              : chatContent(),
        h(
          'p',
          {
            className: 'rentalos-preview-notice',
            role: 'status',
            'aria-live': 'polite',
          },
          notice,
        ),
      ),
    ),
    composer,
  );
  return h(
    'div',
    {
      className: css.viewport,
      role: 'region',
      'aria-label': text(
        'Rental OS AI Native 业务平台交互演示',
        'Rental OS AI Native business platform demo',
      ),
      'data-rentalos-preview': true,
    },
    h(
      'div',
      {
        className: css.window,
      },
      h(
        'aside',
        {
          className: css.sidebar,
          'data-preview-menu': menuOpen ? 'open' : 'closed',
          'aria-label': text(
            '业务对话导航',
            'Business conversation navigation',
          ),
        },
        h(
          'div',
          {
            className: css.windowBar,
          },
          lights(),
          button('', icon('panel'), () => setMenuOpen(false), {
            'aria-label': text('关闭导航', 'Close navigation'),
          }),
        ),
        h(
          'div',
          {
            className: css.brand,
          },
          h('img', {
            src: assetPath('/icons/rentalos-logo.svg'),
            alt: 'Rental OS',
            className: 'rentalos-preview-logo',
            width: 107,
            height: 24,
          }),
        ),
        h(
          'div',
          {
            className: 'rentalos-preview-mode-tabs',
            role: 'tablist',
            'aria-label': text('经营管理方式', 'Management mode'),
          },
          ...[
            ['ai', text('AI 管理', 'AI mode')],
            ['business', text('传统管理', 'Console')],
          ].map(([key, label]) =>
            button('', label, () => switchMode(key), {
              key,
              id: 'rentalos-mode-' + key,
              role: 'tab',
              'aria-selected': mode === key,
              'aria-controls': 'rentalos-preview-panel',
              tabIndex: mode === key ? 0 : -1,
              onKeyDown: (event) => {
                if (
                  !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 'ai'
                    : event.key === 'End'
                      ? 'business'
                      : mode === 'ai'
                        ? 'business'
                        : 'ai';
                switchMode(next);
                event.currentTarget.parentElement
                  .querySelector('#rentalos-mode-' + next)
                  ?.focus();
              },
            }),
          ),
        ),
        h(
          'div',
          {
            className: css.sidebarBody,
          },
          mode === 'ai'
            ? h(
                React.Fragment,
                null,
                nav(
                  'new',
                  text('新对话', 'New conversation'),
                  'newChat',
                  css.newSession,
                ),
                nav('plugins', text('插件', 'Plugins'), 'plugin'),
                nav('automation', text('自动化任务', 'Automation'), 'clock'),
                h(
                  'div',
                  {
                    className: css.workspaceHeader,
                  },
                  h('span', null, text('经营空间', 'Workspace')),
                  h(
                    'div',
                    {
                      className: css.workspaceTools,
                    },
                    icon('sliders'),
                  ),
                ),
                h(
                  'div',
                  {
                    className: css.folderRow + ' ' + css.activeFolder,
                  },
                  icon('folderOpen'),
                  h('span', null, text('租赁业务', 'Rental operations')),
                ),
                h(
                  'div',
                  {
                    className: css.sessions,
                  },
                  ...['overview', 'booking', 'fulfillment', 'operations'].map(
                    (key) =>
                      nav(key, scenes[key].title, 'newChat', css.sessionRow),
                  ),
                ),
                h(
                  'div',
                  {
                    className: css.folders,
                  },
                  nav(
                    'finance',
                    text('财务与结算', 'Finance & settlement'),
                    'folderClosed',
                    css.folderRow,
                  ),
                ),
              )
            : h(
                React.Fragment,
                null,
                h(
                  'div',
                  {
                    className: css.workspaceHeader,
                  },
                  h('span', null, text('业务菜单', 'Business menu')),
                ),
                ...businessMenu.map(([key, name, label]) =>
                  button(
                    css.navRow + (tab === key ? ' ' + css.selected : ''),
                    [
                      icon(name),
                      h(
                        'span',
                        {
                          key: 'label',
                        },
                        label,
                      ),
                    ],
                    () => {
                      setTab(key);
                      setMenuOpen(false);
                    },
                    {
                      key,
                      'aria-pressed': tab === key,
                      'data-business-page': key,
                    },
                  ),
                ),
              ),
        ),
        h(
          'div',
          {
            className: css.account,
          },
          h(
            'span',
            {
              className: css.avatar,
            },
            icon('user'),
          ),
          h('span', null, text('经营者', 'Business owner')),
        ),
      ),
      h(
        'div',
        {
          className: css.main,
          id: 'rentalos-preview-panel',
          role: 'tabpanel',
          'aria-labelledby': 'rentalos-mode-' + mode,
        },
        h(
          'div',
          {
            className: css.mainWindowBar,
          },
          h(
            'div',
            {
              className: css.nativeChrome,
            },
            lights(),
            h(
              'div',
              {
                className: css.nativeControls,
              },
              button('', icon('panel'), () => setMenuOpen(!menuOpen), {
                'aria-label': text('打开业务导航', 'Open business navigation'),
                'aria-expanded': menuOpen,
              }),
            ),
          ),
          h(
            'span',
            {
              className: css.conversationTitle,
            },
            mode === 'business' ? businessTitle : titles[view] || scene.title,
          ),
          actionView
            ? button(
                '',
                icon('panel'),
                () => setWorkspaceOpen(!workspaceOpen),
                {
                  'aria-label': text(
                    '切换 Agent 工作区',
                    'Toggle Agent workspace',
                  ),
                },
              )
            : h('span', null, icon('panel')),
        ),
        h(
          'div',
          {
            className: 'rentalos-agent-body',
            'data-agent-split': actionView ? 'true' : 'false',
          },
          mode === 'business' ? businessContent() : chatPanel,
          actionView && workspace(),
        ),
        actionView && approval && confirmation(),
      ),
    ),
  );
}
