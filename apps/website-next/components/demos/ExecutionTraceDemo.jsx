'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import * as React from 'react';
import { getTraceStyles } from '../shared/styleNames.js';
import { traceSteps } from '../shared/demoData.jsx';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { DetailsIcon } from '../shared/CapabilityIcons.jsx';
import { TraceIcon } from '../shared/CapabilityIcons.jsx';
import { traceLanes } from '../shared/demoData.jsx';
import { traceSpans } from '../shared/demoData.jsx';
import { traceSpanClasses } from '../shared/demoData.jsx';
import { traceKindClasses } from '../shared/demoData.jsx';
export function rentalTraceDetails(n, index, clear) {
  const h = React.createElement,
    c = getTraceStyles(),
    step = traceSteps[index];
  return h(
    'div',
    {
      className: c.details + ' rentalos-trace-detail',
    },
    h(
      'div',
      {
        className: c.detailsHead,
      },
      h(
        'span',
        {
          className: c.detailsTitle,
        },
        n('stepLabel', {
          step: index + 1,
        }),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'rentalos-cap-control',
          onClick: clear,
        },
        n('resume'),
      ),
    ),
    h(
      'div',
      {
        className: 'rentalos-trace-evidence',
      },
      h('strong', null, step.toolName || n('kind.' + step.kind)),
      h('p', null, step.textKey ? n(step.textKey) : step.args),
      step.result && h('p', null, step.result),
      h(
        'small',
        {
          className: 'rentalos-cap-note',
        },
        n('sample'),
      ),
    ),
  );
}
export function ExecutionTraceDemo(e) {
  let { paused: s = false } = e,
    n = useTranslations('Harness.TracePreview'),
    a = useTranslations('Harness.Capabilities'),
    i = useLocale(),
    o = React.useRef(null),
    [c, d] = React.useState(false),
    [u, m] = React.useState(false),
    [p, h] = React.useState(true),
    [rentalStep, setRentalStep] = React.useState(null);
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
      className={getTraceStyles().frame}
      data-rental-capability="trace"
      data-inspecting={null !== rentalStep}
      data-ready={true}
      data-running={u && p && !s && null === rentalStep}
      aria-label={n('accessibleLabel')}
    >
      {<span className={getTraceStyles().floor} aria-hidden="true" />}
      {
        <div className={getTraceStyles().canvas}>
          {
            <div className={getTraceStyles().toolbar}>
              {
                <span
                  className={''
                    .concat(getTraceStyles().toggle, ' ')
                    .concat(getTraceStyles().toggleOn)}
                >
                  {<DetailsIcon />}
                  {n('duration')}
                </span>
              }
              {
                <span className={getTraceStyles().toggle}>
                  {n('turns')}
                  {<span className={getTraceStyles().toggleGlyph}>{'⊟'}</span>}
                </span>
              }
              {
                <span className={getTraceStyles().toggle}>
                  {n('calls')}
                  {<span className={getTraceStyles().toggleGlyph}>{'⊟'}</span>}
                </span>
              }
              {
                <span className={getTraceStyles().search}>
                  {<TraceIcon />}
                  {n('search')}
                </span>
              }
            </div>
          }
          {
            <div className={getTraceStyles().timeline}>
              {
                <div className={getTraceStyles().laneLabels}>
                  {traceLanes.map((e) => (
                    <span key={e}>{n('lane.'.concat(e))}</span>
                  ))}
                </div>
              }
              {
                <div className={getTraceStyles().track}>
                  {traceSpans.map((e) => (
                    <span
                      key={''.concat(e.lane, '-').concat(e.left)}
                      data-lane={e.lane}
                      className={''
                        .concat(getTraceStyles().span, ' ')
                        .concat(traceSpanClasses[e.kind])}
                      style={{
                        '--span-left': ''.concat(e.left, '%'),
                        '--span-width': ''.concat(e.width, '%'),
                      }}
                    />
                  ))}
                </div>
              }
            </div>
          }
          {
            <div className={getTraceStyles().body}>
              {
                <div className={getTraceStyles().listViewport}>
                  {
                    <div className={getTraceStyles().listTrack}>
                      {traceSteps.map((e, rentalIndex) => {
                        var s;
                        return (
                          <button
                            key={e.key}
                            type="button"
                            onClick={() => setRentalStep(rentalIndex)}
                            aria-label={
                              n('reviewStep') + ' ' + (rentalIndex + 1)
                            }
                            className={
                              getTraceStyles().row + ' rentalos-cap-control'
                            }
                            data-row={e.kind}
                            data-tool={e.toolName}
                          >
                            {undefined !== e.turn && (
                              <span className={getTraceStyles().turnLabel}>
                                {n('turnLabel', {
                                  turn: e.turn,
                                })}
                              </span>
                            )}
                            {
                              <span className={getTraceStyles().kindSlot}>
                                {
                                  <span
                                    className={''
                                      .concat(getTraceStyles().kindTag, ' ')
                                      .concat(traceKindClasses[e.kind])}
                                  >
                                    {n('kind.'.concat(e.kind))}
                                  </span>
                                }
                              </span>
                            }
                            {
                              <span className={getTraceStyles().content}>
                                {e.toolName ? (
                                  <React.Fragment>
                                    {
                                      <span
                                        className={getTraceStyles().toolName}
                                      >
                                        {e.toolName}
                                      </span>
                                    }
                                    {
                                      <span
                                        className={getTraceStyles().toolArgs}
                                      >
                                        {e.args}
                                      </span>
                                    }
                                    {e.result && (
                                      <React.Fragment>
                                        {
                                          <span
                                            className={getTraceStyles().arrow}
                                          >
                                            {'→'}
                                          </span>
                                        }
                                        {
                                          <span
                                            className={
                                              getTraceStyles().toolResult
                                            }
                                          >
                                            {e.result}
                                          </span>
                                        }
                                      </React.Fragment>
                                    )}
                                  </React.Fragment>
                                ) : (
                                  n(
                                    null !== (s = e.textKey) && undefined !== s
                                      ? s
                                      : '',
                                  )
                                )}
                              </span>
                            }
                          </button>
                        );
                      })}
                    </div>
                  }
                </div>
              }
              {null !== rentalStep ? (
                rentalTraceDetails(n, rentalStep, () => setRentalStep(null))
              ) : (
                <div className={getTraceStyles().details} data-panel={true}>
                  {
                    <div className={getTraceStyles().detailsHead}>
                      {
                        <span
                          className={''
                            .concat(getTraceStyles().kindTag, ' ')
                            .concat(getTraceStyles().kindTool)}
                        >
                          {n('kind.tool')}
                        </span>
                      }
                      {
                        <span className={getTraceStyles().detailsTitle}>
                          {n('turnLabel', {
                            turn: 1,
                          })}
                          {' \xb7 '}
                          {n('stepLabel', {
                            step: 1,
                          })}
                        </span>
                      }
                      {
                        <span className={getTraceStyles().detailsClose}>
                          {'\xd7'}
                        </span>
                      }
                    </div>
                  }
                  {
                    <div className={getTraceStyles().detailsTabs}>
                      {['summary', 'payload', 'result', 'schema', 'timing'].map(
                        (e) => (
                          <span
                            key={e}
                            className={getTraceStyles().detailsTab}
                            data-tab={e}
                          >
                            {n('tab.'.concat(e))}
                          </span>
                        ),
                      )}
                    </div>
                  }
                  {
                    <div
                      className={''
                        .concat(getTraceStyles().detailsBody, ' ')
                        .concat(getTraceStyles().tabResult)}
                    >
                      {
                        <span className={getTraceStyles().resultValue}>
                          {'AVAILABLE · sample'}
                        </span>
                      }
                    </div>
                  }
                  {
                    <div
                      className={''
                        .concat(getTraceStyles().detailsBody, ' ')
                        .concat(getTraceStyles().tabTiming)}
                    >
                      {
                        <dl className={getTraceStyles().timingFields}>
                          {<dt>{n('started')}</dt>}
                          {<dd>{'2026-10-22 09:30:00 · sample'}</dd>}
                          {<dt>{n('duration')}</dt>}
                          {
                            <dd>
                              {n('unitMilliseconds', {
                                value: 34,
                              })}
                            </dd>
                          }
                          {<dt>{n('source')}</dt>}
                          {<dd>{n('sessionTimestamps')}</dd>}
                          {<dt>{n('hierarchy')}</dt>}
                          {<dd>{n('assistantMessage')}</dd>}
                        </dl>
                      }
                    </div>
                  }
                </div>
              )}
            </div>
          }
        </div>
      }
    </figure>
  );
}
