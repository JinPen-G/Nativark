'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import * as React from 'react';
import { HERO_BACKGROUND_PARAMS } from '../effects/HeroBackground.jsx';
import { useScroll } from 'framer-motion';
import { useTransform } from 'framer-motion';
import { useSpring } from 'framer-motion';
import { motion } from 'framer-motion';
import { HeroBackground } from '../effects/HeroBackground.jsx';
import { PreviewBadge } from '../ui/PreviewBadge.jsx';
import { Heading } from '../shared/Heading.jsx';
import { DemoDownload } from '../ui/DemoDownload.jsx';
import { trackInteraction } from '../../lib/site.js';
import { getHeroStyles } from '../shared/styleNames.js';
import { BusinessPreview } from '../demos/BusinessPreview.jsx';
export function HeroSection() {
  let t = useTranslations('Harness.Index'),
    locale = useLocale(),
    [backgroundParams, setBackgroundParams] = React.useState(
      HERO_BACKGROUND_PARAMS,
    ),
    heroRef = React.useRef(null),
    [scrollBlur, setScrollBlur] = React.useState(0),
    { scrollYProgress: scrollProgress } = useScroll({
      target: heroRef,
      offset: ['start start', 'end start'],
    }),
    tiltProgress = useTransform(scrollProgress, [0, 0.65], [0, 1]),
    smoothProgress = useSpring(tiltProgress, {
      stiffness: 160,
      damping: 28,
      mass: 0.6,
    }),
    previewTransform = useTransform(smoothProgress, (e) => {
      let s = Math.min(1, Math.max(0, e));
      return s < 0.001
        ? 'none'
        : 'perspective(1600px) rotateX('
            .concat(5 * s, 'deg) scale(')
            .concat(1 - 0.015 * s, ')');
    });
  React.useEffect(() => {
    let e = () => {
      let e = heroRef.current;
      if (!e) return;
      let s = e.getBoundingClientRect(),
        n = e.offsetHeight,
        r = Math.min(1, Math.max(0, -s.top / (0.6 * n)));
      setScrollBlur(20 * r);
    };
    window.addEventListener('scroll', e, {
      passive: true,
    });
    return () => window.removeEventListener('scroll', e);
  }, []);
  return (
    <section ref={heroRef} className="relative flex items-center w-full">
      {
        <motion.div
          initial={{
            opacity: 0,
            filter: 'blur(20px)',
          }}
          animate={{
            opacity: 1,
            filter: 'blur('.concat(scrollBlur, 'px)'),
          }}
          transition={{
            duration: scrollBlur > 0 ? 0 : 1.8,
            ease: 'easeOut',
          }}
          className="absolute inset-0 z-0 overflow-hidden"
          style={{
            mask: 'linear-gradient(#000000fc 0%, #000000e8 8.98%, transparent 100%)',
            WebkitMask:
              'linear-gradient(#000000fc 0%, #000000e8 8.98%, transparent 100%)',
          }}
        >
          {<HeroBackground params={backgroundParams} />}
        </motion.div>
      }
      {
        <div className="relative z-10 ds-container flex flex-col items-center gap-ds-7 md:gap-ds-8 pt-ds-11 pb-ds-9">
          {
            <div className="flex w-full max-w-[800px] flex-col items-center gap-ds-6 pt-ds-4 text-center">
              {
                <div
                  className="ds-hero-enter flex flex-col items-center gap-ds-4"
                  style={{
                    '--enter-y': '24px',
                    '--enter-blur': '10px',
                    animationDuration: '0.9s',
                  }}
                >
                  {
                    <span
                      data-hero-preview-label={true}
                      className="inline-flex"
                    >
                      {
                        <PreviewBadge
                          variant="micro"
                          label={t('harnessPreviewLabel')}
                        >
                          {t('harnessPreviewBadge')}
                        </PreviewBadge>
                      }
                    </span>
                  }
                  {
                    <Heading
                      as="h1"
                      className={'ds-text-hero text-ds-primary '.concat(
                        'en' === locale ? 'text-[32px] md:text-[40px]' : '',
                      )}
                    >
                      {t('harnessHeroTitlePre')}
                      {t('harnessHeroTitlePost') && (
                        <React.Fragment>
                          {<br />}
                          {t('harnessHeroTitlePost')}
                        </React.Fragment>
                      )}
                    </Heading>
                  }
                </div>
              }
              {
                <div
                  className="ds-hero-enter w-full max-w-[720px] flex flex-col gap-ds-1"
                  style={{
                    '--enter-y': '20px',
                    '--enter-blur': '8px',
                    animationDelay: '0.15s',
                  }}
                >
                  {
                    <p className="ds-text-body text-ds-description">
                      {t('harnessHeroDesc')}
                    </p>
                  }
                  {
                    <p className="ds-text-body text-ds-description">
                      {t('harnessHeroDesc2')}
                    </p>
                  }
                </div>
              }
              {
                <div
                  className="ds-hero-enter relative z-20 mt-ds-2"
                  style={{
                    '--enter-y': '16px',
                    animationDuration: '0.7s',
                    animationDelay: '0.3s',
                  }}
                >
                  {
                    <DemoDownload
                      rentalDemo={true}
                      label={t('harnessDemoAction')}
                      showIcon={false}
                      onDownload={(e) => {
                        e &&
                          trackInteraction(
                            'macOS' === e
                              ? 'hero_download_mac'
                              : 'hero_download_win',
                          );
                      }}
                    />
                  }
                </div>
              }
            </div>
          }
          {
            <div className="ds-hero-preview-enter max-w-[1020px] w-full">
              {
                <motion.div
                  className={getHeroStyles().previewSurface}
                  style={{
                    transform: previewTransform,
                  }}
                >
                  {<BusinessPreview />}
                </motion.div>
              }
            </div>
          }
        </div>
      }
      {false}
    </section>
  );
}
