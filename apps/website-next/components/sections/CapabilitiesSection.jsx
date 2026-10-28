'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import { ReturnReminderDemo } from '../demos/ReturnReminderDemo.jsx';
import { DeliverablesDemo } from '../demos/DeliverablesDemo.jsx';
import { ScheduledOperationsDemo } from '../demos/ScheduledOperationsDemo.jsx';
import { ExecutionTraceDemo } from '../demos/ExecutionTraceDemo.jsx';
import { useTranslations } from 'next-intl';
import { useReducedMotion } from 'framer-motion';
import * as React from 'react';
import { motion } from 'framer-motion';
import { getCapabilityStyles } from '../shared/styleNames.js';
import { EASE_IN_OUT } from '../ui/primitives.jsx';
import { Heading } from '../shared/Heading.jsx';
import { capabilityKinds } from '../shared/demoData.jsx';
export let capabilityDemos = {
  plugins: ReturnReminderDemo,
  deliverables: DeliverablesDemo,
  workflow: ScheduledOperationsDemo,
  trace: ExecutionTraceDemo,
};
export function CapabilitiesSection() {
  let tIndex = useTranslations('Harness.Index'),
    tCapability = useTranslations('Harness.Capabilities'),
    reducedMotion = useReducedMotion(),
    [paused, setPaused] = React.useState({});
  return (
    <section
      className="ds-container pt-ds-11 pb-ds-11"
      aria-labelledby="harness-capabilities-title"
    >
      {
        <motion.div
          className={''.concat(
            getCapabilityStyles().entrance,
            ' max-w-[820px] mx-auto flex flex-col items-center gap-ds-7 text-center',
          )}
          initial={
            !reducedMotion && {
              opacity: 0,
              y: 20,
            }
          }
          whileInView={{
            opacity: 1,
            y: 0,
          }}
          viewport={{
            once: true,
          }}
          transition={{
            duration: reducedMotion ? 0 : 0.6,
            ease: EASE_IN_OUT,
          }}
        >
          {
            <Heading
              as="h2"
              id="harness-capabilities-title"
              className="ds-text-heading1 text-ds-primary"
            >
              {tIndex.rich('harnessWhyTitle', {
                brand: (e) => <span className="text-ds-brand">{e}</span>,
                br: () => <br className="hidden md:block" />,
              })}
            </Heading>
          }
        </motion.div>
      }
      {
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-ds-6 mt-ds-9">
          {capabilityKinds.map((e, t) => {
            let l = capabilityDemos[e],
              u = true === paused[e];
            return (
              <motion.article
                key={e}
                className={''
                  .concat(getCapabilityStyles().card, ' ')
                  .concat(getCapabilityStyles().entrance)}
                initial={
                  !reducedMotion && {
                    opacity: 0,
                    y: 30,
                  }
                }
                whileInView={{
                  opacity: 1,
                  y: 0,
                }}
                viewport={{
                  once: true,
                }}
                transition={{
                  duration: reducedMotion ? 0 : 0.6,
                  ease: EASE_IN_OUT,
                  delay: reducedMotion ? 0 : 0.1 * t,
                }}
              >
                {
                  <div className={getCapabilityStyles().copy}>
                    {
                      <Heading
                        as="h3"
                        className="ds-text-subtitle text-ds-primary"
                      >
                        {tCapability(''.concat(e, '.title'))}
                      </Heading>
                    }
                    {
                      <p className="ds-text-body text-ds-description">
                        {tCapability.rich(''.concat(e, '.description'), {
                          cordis: (e) => (
                            <a
                              href="https://github.com/cordiverse/cordis"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-ds-primary underline decoration-dashed underline-offset-4 hover:text-ds-brand"
                            >
                              {e}
                            </a>
                          ),
                        })}
                      </p>
                    }
                  </div>
                }
                {
                  <div
                    className={''
                      .concat(getCapabilityStyles().media, ' ')
                      .concat(getCapabilityStyles().elementMedia, ' ')
                      .concat(
                        'trace' === e ? getCapabilityStyles().mediaGrow : '',
                      )}
                  >
                    {
                      <button
                        className={getCapabilityStyles().pauseControl}
                        type="button"
                        onClick={() =>
                          setPaused((s) => ({
                            ...s,
                            [e]: !s[e],
                          }))
                        }
                        aria-label={tCapability(
                          u ? 'playAnimation' : 'pauseAnimation',
                        )}
                      >
                        {
                          <svg
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            {
                              <path
                                d={
                                  u
                                    ? 'M5 3L12 8L5 13Z'
                                    : 'M5.5 3.5V12.5M10.5 3.5V12.5'
                                }
                              />
                            }
                          </svg>
                        }
                      </button>
                    }
                    {React.createElement(l, {
                      paused: u,
                    })}
                  </div>
                }
              </motion.article>
            );
          })}
        </div>
      }
    </section>
  );
}
