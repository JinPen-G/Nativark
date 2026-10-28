'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { ParticleField } from '../effects/ParticleField.jsx';
import { motion } from 'framer-motion';
import { InteractiveGrid } from '../effects/InteractiveGrid.jsx';
import { EASE_IN_OUT } from '../ui/primitives.jsx';
import { Heading } from '../shared/Heading.jsx';
import { Button } from '../ui/primitives.jsx';
export function PartnershipSection() {
  const t = useTranslations('Harness.Index');
  const locale = useLocale();
  return (
    <div
      className="relative overflow-hidden"
      style={{
        maxHeight: '720px',
      }}
    >
      {
        <div
          className="absolute -inset-[30%] z-0 pointer-events-none hidden md:block"
          style={{
            mixBlendMode: 'screen',
            transform: 'translateY(-8%)',
            mask: 'radial-gradient(ellipse 60% 60% at center, black 0%, transparent 70%)',
            WebkitMask:
              'radial-gradient(ellipse 60% 60% at center, black 0%, transparent 70%)',
          }}
        >
          {<ParticleField className="w-full h-full" />}
        </div>
      }
      {
        <motion.div
          className="absolute top-[80px] left-0 w-full h-[500px] pointer-events-none z-0"
          initial={{
            opacity: 0,
            scale: 0.85,
          }}
          whileInView={{
            opacity: 1,
            scale: 1,
          }}
          viewport={{
            once: true,
            margin: '-100px',
          }}
          transition={{
            duration: 1.2,
            ease: 'easeOut',
          }}
        >
          {
            <div
              className="absolute inset-0"
              style={{
                mask: 'linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%), linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)',
                maskComposite: 'intersect',
                WebkitMaskComposite: 'source-in',
              }}
            >
              {
                <InteractiveGrid
                  lineColor="rgba(255, 255, 255,"
                  dotColor="rgba(255, 255, 255,"
                  lineOpacity={0.05}
                  dotOpacity={0.12}
                />
              }
            </div>
          }
          {
            <div
              className="absolute bottom-[-100px] left-[10%] w-[500px] h-[500px] opacity-30"
              style={{
                background:
                  'radial-gradient(circle, #1A3870 0%, transparent 70%)',
                filter: 'blur(80px)',
              }}
            />
          }
          {
            <div
              className="absolute bottom-[-50px] left-[50%] -translate-x-1/2 w-[700px] h-[400px] opacity-40"
              style={{
                background:
                  'radial-gradient(ellipse at center, #2D5F9E 0%, #1A3870 40%, transparent 70%)',
                filter: 'blur(100px)',
              }}
            />
          }
          {
            <div
              className="absolute bottom-[-80px] right-[10%] w-[400px] h-[400px] opacity-20"
              style={{
                background:
                  'radial-gradient(circle, #4A8AC4 0%, #2D5F9E 30%, transparent 70%)',
                filter: 'blur(60px)',
              }}
            />
          }
        </motion.div>
      }
      {
        <motion.section
          id="products"
          initial={{
            opacity: 0,
            y: 40,
            filter: 'blur(10px)',
          }}
          whileInView={{
            opacity: 1,
            y: 0,
            filter: 'blur(0px)',
            transitionEnd: {
              filter: 'none',
            },
          }}
          viewport={{
            once: true,
            margin: '-100px',
          }}
          transition={{
            duration: 0.6,
            ease: EASE_IN_OUT,
          }}
          className="relative z-10 ds-container flex flex-col items-center text-center scroll-mt-[100px] pt-ds-11 pb-ds-13"
          style={{
            minHeight: 'min(60vh, 720px)',
          }}
        >
          {
            <Heading as="h2" className="ds-text-heading1 text-ds-primary">
              {t('harnessCtaTitle')}
            </Heading>
          }
          {
            <p className="ds-text-body text-ds-description max-w-[652px] mt-ds-5">
              {t('harnessCtaDesc')}
            </p>
          }
          {
            <div
              className={'harness-cta-actions flex w-full sm:w-auto flex-wrap items-center justify-center gap-ds-4 mt-ds-6 max-sm:[&>a]:w-full '.concat(
                'en' === locale ? 'md:grid md:grid-cols-2 md:w-fit' : '',
              )}
            >
              {
                <Button
                  as="button"
                  type="button"
                  variant="primary"
                  aria-haspopup="dialog"
                  aria-controls="demo-request"
                  onClick={(event) =>
                    document.dispatchEvent(
                      new CustomEvent('rentalos:request-demo', {
                        detail: {
                          trigger: event.currentTarget,
                          topic: t('harnessPartner1Inquiry'),
                        },
                      }),
                    )
                  }
                >
                  {t('harnessPartner1Action')}
                </Button>
              }
              {
                <Button
                  as="button"
                  type="button"
                  variant="secondary"
                  aria-haspopup="dialog"
                  aria-controls="demo-request"
                  onClick={(event) =>
                    document.dispatchEvent(
                      new CustomEvent('rentalos:request-demo', {
                        detail: {
                          trigger: event.currentTarget,
                          topic: t('harnessPartner2Inquiry'),
                        },
                      }),
                    )
                  }
                >
                  {t('harnessPartner2Action')}
                </Button>
              }
              {
                <Button
                  as="button"
                  type="button"
                  variant="secondary"
                  aria-haspopup="dialog"
                  aria-controls="demo-request"
                  onClick={(event) =>
                    document.dispatchEvent(
                      new CustomEvent('rentalos:request-demo', {
                        detail: {
                          trigger: event.currentTarget,
                          topic: t('harnessPartner3Inquiry'),
                        },
                      }),
                    )
                  }
                >
                  {t('harnessPartner3Action')}
                </Button>
              }
              {
                <Button
                  as="button"
                  type="button"
                  variant="secondary"
                  aria-haspopup="dialog"
                  aria-controls="demo-request"
                  onClick={(event) =>
                    document.dispatchEvent(
                      new CustomEvent('rentalos:request-demo', {
                        detail: {
                          trigger: event.currentTarget,
                          topic: t('harnessPartner4Inquiry'),
                        },
                      }),
                    )
                  }
                >
                  {t('harnessPartner4Action')}
                </Button>
              }
            </div>
          }
        </motion.section>
      }
    </div>
  );
}
