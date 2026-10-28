'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { EASE_IN_OUT } from '../ui/primitives.jsx';
import { Heading } from '../shared/Heading.jsx';
export function DeploymentSection() {
  let t = useTranslations('Harness.Index'),
    options = [1, 2].map((index) => ({
      label: t('harnessUse' + index + 'Label'),
      desc: t('harnessUse' + index + 'Desc'),
      action: t('harnessUse' + index + 'Action'),
      topic: t('harnessUse' + index + 'Inquiry'),
    }));
  return (
    <section
      className="ds-container py-ds-10"
      id="deployment-options"
      aria-labelledby="deployment-title"
    >
      {
        <motion.div
          initial={{
            opacity: 0,
            y: 20,
          }}
          whileInView={{
            opacity: 1,
            y: 0,
          }}
          viewport={{
            once: true,
          }}
          transition={{
            duration: 0.6,
            ease: EASE_IN_OUT,
          }}
        >
          {
            <Heading
              as="h2"
              id="deployment-title"
              className="ds-text-heading1 text-ds-primary mb-ds-9 max-w-[600px]"
            >
              {t('harnessUseTitle')}
            </Heading>
          }
        </motion.div>
      }
      {
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-ds-6 items-stretch">
          {options.map((n, t) => (
            <motion.div
              key={n.label}
              initial={{
                opacity: 0,
                y: 30,
              }}
              whileInView={{
                opacity: 1,
                y: 0,
              }}
              viewport={{
                once: true,
              }}
              transition={{
                duration: 0.6,
                ease: EASE_IN_OUT,
                delay: 0.1 * t,
              }}
              className="min-w-0 flex flex-col rounded-ds-panel bg-ds-surface-3 border border-ds-border-default"
            >
              {
                <div className="min-w-0 flex flex-col gap-ds-3 p-ds-7 rentalos-deployment-card-body">
                  {
                    <Heading
                      as="h3"
                      className="ds-text-subtitle text-ds-primary"
                    >
                      {n.label}
                    </Heading>
                  }
                  {
                    <p className="ds-text-body text-ds-description leading-[1.7] rentalos-deployment-description">
                      {n.desc}
                    </p>
                  }
                  {
                    <div className="mt-ds-2">
                      {
                        <button
                          type="button"
                          className="ds-btn-primary ds-btn-m"
                          aria-haspopup="dialog"
                          aria-controls="demo-request"
                          onClick={(event) =>
                            document.dispatchEvent(
                              new CustomEvent('rentalos:request-demo', {
                                detail: {
                                  trigger: event.currentTarget,
                                  topic: n.topic,
                                },
                              }),
                            )
                          }
                        >
                          {n.action}
                        </button>
                      }
                    </div>
                  }
                </div>
              }
            </motion.div>
          ))}
        </div>
      }
    </section>
  );
}
