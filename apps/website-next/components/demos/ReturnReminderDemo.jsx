'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import * as React from 'react';
import { getPluginStyles } from '../shared/styleNames.js';
import { PluginIcon } from '../shared/CapabilityIcons.jsx';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { PreviewIcon } from '../shared/CapabilityIcons.jsx';
import { ToolIcon } from '../shared/CapabilityIcons.jsx';
import { toolSteps } from '../shared/demoData.jsx';
import { ToolStepIcon } from '../shared/CapabilityIcons.jsx';
import { pluginCarouselKinds } from '../shared/demoData.jsx';
export function rentalReminder(n, enabled, setEnabled) {
  const h = React.createElement,
    c = getPluginStyles();
  return h(
    React.Fragment,
    null,
    h(
      'div',
      {
        className: c.widgetExpanded,
      },
      h(
        'div',
        {
          className: c.widgetTitle,
        },
        h(PluginIcon, {
          kind: 'schedule',
        }),
        h('span', null, n('pomodoro.name')),
      ),
      h(
        'div',
        {
          className: c.timerTabs,
        },
        h('span', null, n('channel')),
      ),
      h(
        'strong',
        {
          className: 'rentalos-reminder-time',
        },
        '16:00',
      ),
      h(
        'span',
        {
          className: 'rentalos-cap-note',
        },
        n('recipient'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: c.timerStart + ' rentalos-cap-control',
          onClick: () => setEnabled(!enabled),
          'aria-pressed': enabled,
        },
        n(enabled ? 'enabledDemo' : 'confirm'),
      ),
      h(
        'small',
        {
          className: 'rentalos-cap-note',
        },
        n('demoNote'),
      ),
    ),
    h(
      'div',
      {
        className: c.widgetCompact,
      },
      h(
        'strong',
        {
          className: c.compactDigits,
        },
        '16:00',
      ),
      h(
        'span',
        {
          className: c.compactLabel,
        },
        n(enabled ? 'enabledDemo' : 'pomodoro.name'),
      ),
    ),
  );
}
export function ReturnReminderDemo(e) {
  let { paused: s = false } = e,
    n = useTranslations('Harness.PluginsPreview'),
    a = useTranslations('Harness.Capabilities'),
    i = useLocale(),
    o = React.useRef(null),
    [c, d] = React.useState(false),
    [u, m] = React.useState(false),
    [p, h] = React.useState(true),
    [rentalEnabled, setRentalEnabled] = React.useState(false);
  React.useEffect(() => {
    let e = o.current;
    if (!e) return;
    d(true);
    let s = new IntersectionObserver(
        (e) => {
          let [s] = e;
          return m(s.isIntersecting);
        },
        {
          threshold: 0.15,
        },
      ),
      n = () => h(!document.hidden);
    n();
    s.observe(e);
    document.addEventListener('visibilitychange', n);
    return () => {
      (s.disconnect(), document.removeEventListener('visibilitychange', n));
    };
  }, []);
  return (
    <figure
      ref={o}
      className={getPluginStyles().frame}
      data-rental-capability="plugins"
      data-confirmed={rentalEnabled}
      data-ready={true}
      data-running={u && p && !s}
      aria-label={n('accessibleLabel')}
    >
      {
        <div className={getPluginStyles().canvas}>
          {
            <div className={getPluginStyles().conversation}>
              {
                <div className={getPluginStyles().composerGroup}>
                  {
                    <div className={getPluginStyles().mode}>
                      {<PreviewIcon name="agentPreset" />}
                      {n('creatorMode')}
                      {<PreviewIcon name="chevronDown" />}
                    </div>
                  }
                  {
                    <div className={getPluginStyles().composer}>
                      {
                        <div className={getPluginStyles().prompt}>
                          {<span>{n('prompt')}</span>}
                        </div>
                      }
                      {
                        <div className={getPluginStyles().toolbar}>
                          {
                            <span className={getPluginStyles().attachment}>
                              {<PreviewIcon name="plus" />}
                            </span>
                          }
                          {
                            <span className={getPluginStyles().send}>
                              {<ToolIcon kind="arrow" />}
                            </span>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
          {
            <div className={getPluginStyles().chatView}>
              {
                <div className={getPluginStyles().userMessage}>
                  {n('prompt')}
                </div>
              }
              {
                <div className={getPluginStyles().process}>
                  {
                    <div className={getPluginStyles().workingState}>
                      {
                        <div className={getPluginStyles().processTitle}>
                          {<span>{n('working')}</span>}
                          {
                            <span className={getPluginStyles().processChevron}>
                              {<PreviewIcon name="chevronDown" />}
                            </span>
                          }
                        </div>
                      }
                    </div>
                  }
                  {
                    <div className={getPluginStyles().toolCalls}>
                      {
                        <div className={getPluginStyles().toolCallsInner}>
                          {toolSteps.map((e) => (
                            <div
                              key={e.key}
                              className={''
                                .concat(getPluginStyles().toolRow, ' ')
                                .concat(
                                  'think' === e.type
                                    ? getPluginStyles().thinkRow
                                    : '',
                                  ' ',
                                )
                                .concat(
                                  'call' === e.type
                                    ? getPluginStyles().callRow
                                    : '',
                                )}
                              data-tool={e.key}
                              data-kind={e.type}
                            >
                              {<ToolStepIcon kind={e.icon} />}
                              {
                                <span className={getPluginStyles().toolTitle}>
                                  {n('tools.'.concat(e.label))}
                                </span>
                              }
                              {
                                <span
                                  className={getPluginStyles().toolSeparator}
                                />
                              }
                              {
                                <span
                                  className={''
                                    .concat(getPluginStyles().toolSummary, ' ')
                                    .concat(
                                      e.file
                                        ? getPluginStyles().fileSummary
                                        : '',
                                    )}
                                >
                                  {e.summaryKey
                                    ? n('toolSummaries.'.concat(e.summaryKey))
                                    : e.summary}
                                </span>
                              }
                              {e.diff && (
                                <span className={getPluginStyles().toolDiff}>
                                  {'+'}
                                  {e.diff[0]}
                                  {' −'}
                                  {e.diff[1]}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      }
                    </div>
                  }
                  {
                    <div className={getPluginStyles().finishedState}>
                      {<span>{n('finished')}</span>}
                      {<PreviewIcon name="chevronDown" />}
                    </div>
                  }
                  {
                    <p className={getPluginStyles().completionCopy}>
                      {n('completion')}
                    </p>
                  }
                </div>
              }
            </div>
          }
          {
            <div className={getPluginStyles().manager}>
              {
                <div className={getPluginStyles().managerHeader}>
                  {<span>{n('plugins')}</span>}
                </div>
              }
              {
                <div className={getPluginStyles().listViewport}>
                  {
                    <div className={getPluginStyles().listTrack}>
                      {
                        <div className={getPluginStyles().groupLabel}>
                          {n('official')}
                        </div>
                      }
                      {pluginCarouselKinds.map((e) => (
                        <div key={e} className={getPluginStyles().pluginRow}>
                          {
                            <span className={getPluginStyles().iconWell}>
                              {<PluginIcon kind={e} />}
                            </span>
                          }
                          {
                            <span className={getPluginStyles().pluginCopy}>
                              {
                                <span className={getPluginStyles().pluginTitle}>
                                  {
                                    <span
                                      className={getPluginStyles().pluginName}
                                    >
                                      {n(''.concat(e, '.name'))}
                                    </span>
                                  }
                                  {('team' === e ||
                                    'review' === e ||
                                    'schedule' === e ||
                                    'voice' === e) && (
                                    <span
                                      className={getPluginStyles().experimental}
                                    >
                                      {n('experimental')}
                                    </span>
                                  )}
                                </span>
                              }
                            </span>
                          }
                        </div>
                      ))}
                      {
                        <div
                          className={''
                            .concat(getPluginStyles().groupLabel, ' ')
                            .concat(getPluginStyles().installedLabel)}
                        >
                          {n('installed')}
                        </div>
                      }
                      {
                        <div
                          className={''
                            .concat(getPluginStyles().pluginRow, ' ')
                            .concat(getPluginStyles().newPlugin)}
                        >
                          {
                            <span className={getPluginStyles().iconWell}>
                              {<PluginIcon kind="schedule" />}
                            </span>
                          }
                          {
                            <span className={getPluginStyles().pluginCopy}>
                              {
                                <span className={getPluginStyles().pluginName}>
                                  {n('pomodoro.name')}
                                </span>
                              }
                            </span>
                          }
                          {
                            <span className={getPluginStyles().toggle}>
                              {<i />}
                            </span>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
          {
            <div className={getPluginStyles().timerWidget}>
              {rentalReminder(n, rentalEnabled, setRentalEnabled)}
            </div>
          }
        </div>
      }
    </figure>
  );
}
