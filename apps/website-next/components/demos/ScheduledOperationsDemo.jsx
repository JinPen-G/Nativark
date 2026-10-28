'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { scheduleExamples } from '../shared/demoData.jsx';
import { getWorkflowStyles } from '../shared/styleNames.js';
import { DownIcon } from '../shared/CapabilityIcons.jsx';
import { workflowToolName } from '../shared/demoData.jsx';
import { ClockIcon } from '../shared/CapabilityIcons.jsx';
export function rentalSchedule(n, f, open, setOpen, enabled, setEnabled) {
  const h = React.createElement;
  if (!open) return null;
  return h(
    'div',
    {
      className: 'rentalos-cap-overlay',
    },
    h(
      'section',
      {
        className: 'rentalos-cap-review',
        role: 'dialog',
        'aria-label': n('planHeading'),
        onKeyDown: (e) => {
          if (e.key === 'Escape') setOpen(false);
        },
      },
      h('h4', null, n('planHeading')),
      h('strong', null, f('title')),
      h('p', null, f('prompt')),
      h(
        'p',
        {
          className: 'rentalos-cap-note',
        },
        f('frequency'),
      ),
      h(
        'p',
        {
          role: 'status',
        },
        n(enabled ? 'enabledDemo' : 'scheduled'),
      ),
      h(
        'div',
        {
          className: 'rentalos-cap-actions',
        },
        h(
          'button',
          {
            type: 'button',
            className: 'rentalos-cap-control',
            onClick: () => setOpen(false),
          },
          n('close'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'rentalos-cap-primary',
            disabled: enabled,
            onClick: () => setEnabled(true),
          },
          n(enabled ? 'enabledDemo' : 'confirm'),
        ),
      ),
      h(
        'small',
        {
          className: 'rentalos-cap-note',
        },
        n('demoNote'),
      ),
    ),
  );
}
export function ScheduledOperationsDemo(e) {
  let { paused: s = false } = e,
    n = useTranslations('Harness.WorkflowPreview'),
    a = useLocale(),
    [i, o] = React.useState(''),
    c = React.useRef(null),
    [d, u] = React.useState(false),
    [m, p] = React.useState(0),
    [rentalPlan, setRentalPlan] = React.useState(false),
    [rentalScheduled, setRentalScheduled] = React.useState(false),
    h = scheduleExamples[m],
    f = (e) => n('scenarios.'.concat(h.key, '.').concat(e)),
    { input: x, result: _ } = (function (e, s, n) {
      let r = {
          time: e.time,
          time_zone: 'Asia/Shanghai',
        },
        t = {
          prompt: n,
          title: s,
          ...('weekly' === e.kind
            ? {
                weekly: {
                  ...r,
                  weekdays: e.weekdays,
                },
              }
            : {
                daily: r,
              }),
        },
        a = {
          id: e.id,
          kind: e.kind,
          title: s,
          prompt: n,
          time: ''.concat(e.time, '.000'),
          timeZone: 'Asia/Shanghai',
          ...('weekly' === e.kind
            ? {
                weekdays: e.weekdays,
              }
            : {}),
          scheduledAt: e.scheduledAt,
          state: 'draft',
          deliveryMode: 'review',
        };
      return {
        input: t,
        result: a,
      };
    })(h, f('title'), f('prompt'));
  React.useEffect(() => {
    o(
      new Intl.DateTimeFormat(a, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
        timeZone: 'Asia/Shanghai',
      }).format(new Date(_.scheduledAt)),
    );
  }, [a, _.scheduledAt]);
  React.useEffect(() => {
    let e = c.current;
    if (!e) return;
    let s = new IntersectionObserver(
      (e) => {
        let [s] = e;
        return u(s.isIntersecting);
      },
      {
        threshold: 0.1,
      },
    );
    s.observe(e);
    return () => s.disconnect();
  }, []);
  return (
    <figure
      ref={c}
      className={getWorkflowStyles().frame}
      data-rental-capability="workflow"
      aria-label={n('accessibleLabel')}
      data-running={d && !s && !rentalPlan}
      data-paused={s}
      data-scenario={h.key}
      data-demo-time="2026-09-01T00:00:00.000Z"
    >
      {
        <div className={getWorkflowStyles().canvas}>
          {
            <div
              className={getWorkflowStyles().story}
              onAnimationIteration={(e) => {
                e.target === e.currentTarget &&
                  p((e) => (e + 1) % scheduleExamples.length);
              }}
            >
              {
                <div className={getWorkflowStyles().userMessage}>
                  {f('request')}
                </div>
              }
              {
                <div className={getWorkflowStyles().process}>
                  {
                    <div className={getWorkflowStyles().processHeading}>
                      {
                        <span className={getWorkflowStyles().headingLabels}>
                          {
                            <span className={getWorkflowStyles().workingLabel}>
                              {
                                <span
                                  className={getWorkflowStyles().statusText}
                                >
                                  {n('working')}
                                </span>
                              }
                              {
                                <span
                                  className={getWorkflowStyles().processChevron}
                                >
                                  {<DownIcon />}
                                </span>
                              }
                            </span>
                          }
                          {
                            <span className={getWorkflowStyles().finishedLabel}>
                              {
                                <span
                                  className={getWorkflowStyles().statusText}
                                >
                                  {n('finished')}
                                </span>
                              }
                              {
                                <span
                                  className={getWorkflowStyles().processChevron}
                                >
                                  {<DownIcon />}
                                </span>
                              }
                            </span>
                          }
                        </span>
                      }
                    </div>
                  }
                  {
                    <div className={getWorkflowStyles().disclosure}>
                      {
                        <div className={getWorkflowStyles().disclosureInner}>
                          {
                            <div
                              className={getWorkflowStyles().tool}
                              data-tool={workflowToolName}
                              data-tool-input={JSON.stringify(x)}
                              data-tool-result={JSON.stringify(_)}
                            >
                              {
                                <div className={getWorkflowStyles().toolRow}>
                                  {
                                    <span
                                      className={getWorkflowStyles().toolIcon}
                                    >
                                      {<DownIcon />}
                                    </span>
                                  }
                                  {<span>{n('toolTitle')}</span>}
                                  {
                                    <span
                                      className={getWorkflowStyles().separator}
                                    />
                                  }
                                  {
                                    <span
                                      className={
                                        getWorkflowStyles().toolSummary
                                      }
                                    >
                                      {
                                        <span
                                          className={
                                            getWorkflowStyles().pendingSummary
                                          }
                                        >
                                          {x.prompt}
                                        </span>
                                      }
                                      {
                                        <span
                                          className={
                                            getWorkflowStyles().settledSummary
                                          }
                                        >
                                          {_.title}
                                        </span>
                                      }
                                    </span>
                                  }
                                </div>
                              }
                              {
                                <div className={getWorkflowStyles().toolBody}>
                                  {
                                    <div className={getWorkflowStyles().input}>
                                      {
                                        <div
                                          className={
                                            getWorkflowStyles().inputHeading
                                          }
                                        >
                                          {<span>{n('input')}</span>}
                                          {<code>{workflowToolName}</code>}
                                        </div>
                                      }
                                      {
                                        <pre
                                          className={
                                            getWorkflowStyles().arguments
                                          }
                                        >
                                          {
                                            <code>
                                              {'{\n'}
                                              {Object.entries(x).map(
                                                (e, s, n) => {
                                                  let [t, a] = e;
                                                  return (
                                                    <span
                                                      key={t}
                                                      className={
                                                        getWorkflowStyles()
                                                          .argument
                                                      }
                                                    >
                                                      {'  '}
                                                      {
                                                        <span
                                                          className={
                                                            getWorkflowStyles()
                                                              .argumentKey
                                                          }
                                                        >
                                                          {JSON.stringify(t)}
                                                        </span>
                                                      }
                                                      {': '}
                                                      {
                                                        <span>
                                                          {JSON.stringify(a)}
                                                          {s < n.length - 1
                                                            ? ','
                                                            : ''}
                                                        </span>
                                                      }
                                                      {'\n'}
                                                    </span>
                                                  );
                                                },
                                              )}
                                              {'}'}
                                            </code>
                                          }
                                        </pre>
                                      }
                                    </div>
                                  }
                                  {
                                    <div className={getWorkflowStyles().result}>
                                      {
                                        <div
                                          className={
                                            getWorkflowStyles().resultTitle
                                          }
                                        >
                                          {_.title}
                                        </div>
                                      }
                                      {
                                        <dl
                                          className={
                                            getWorkflowStyles().resultFields
                                          }
                                        >
                                          {<dt>{n('scheduledFor')}</dt>}
                                          {<dd>{i}</dd>}
                                          {<dt>{n('repeat')}</dt>}
                                          {<dd>{f('repeat')}</dd>}
                                          {<dt>{n('status')}</dt>}
                                          {<dd>{n('scheduled')}</dd>}
                                        </dl>
                                      }
                                    </div>
                                  }
                                </div>
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
                <div className={getWorkflowStyles().completion}>
                  {
                    <p className={getWorkflowStyles().confirmation}>
                      {f('confirmation')}
                    </p>
                  }
                  {
                    <div className={getWorkflowStyles().taskCard}>
                      {
                        <span className={getWorkflowStyles().clockWell}>
                          {<ClockIcon />}
                        </span>
                      }
                      {
                        <span className={getWorkflowStyles().taskCopy}>
                          {
                            <span className={getWorkflowStyles().taskTitle}>
                              {_.title}
                            </span>
                          }
                          {
                            <span className={getWorkflowStyles().frequency}>
                              {f('frequency')}
                            </span>
                          }
                        </span>
                      }
                      {
                        <button
                          type="button"
                          className={
                            getWorkflowStyles().openLabel +
                            ' rentalos-cap-control'
                          }
                          onClick={() => {
                            setRentalPlan(true);
                            setRentalScheduled(false);
                          }}
                        >
                          {n('open')}
                        </button>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
      {rentalSchedule(
        n,
        f,
        rentalPlan,
        setRentalPlan,
        rentalScheduled,
        setRentalScheduled,
      )}
    </figure>
  );
}
