'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { siteLinks, assetPath } from '../lib/site.js';
import * as React from 'react';
import { motion } from 'framer-motion';
import { LocalizedLink } from './LocalizedLink.jsx';
import { AnimatePresence } from 'framer-motion';
import { PreviewBadge } from './ui/PreviewBadge.jsx';
import { LanguageSwitcher } from './LanguageSwitcher.jsx';
import { Button } from './ui/primitives.jsx';
import { trackInteraction } from '../lib/site.js';
import { DemoDownload } from './ui/DemoDownload.jsx';
import { CloseIcon } from './ui/primitives.jsx';
import { MenuIcon } from './ui/primitives.jsx';
import { ChevronDown } from './ui/primitives.jsx';
import { downloadOptions } from '../lib/site.js';
export function HeaderLogo(e) {
  let { className: n } = e;
  return (
    <img
      src={assetPath('/icons/rentalos-logo.svg')}
      alt="Rental OS"
      height={24}
      className={'rentalos-header-logo '.concat(n || '')}
    />
  );
}
export function SiteHeader() {
  let t = useTranslations('Harness.Index'),
    locale = useLocale(),
    docsUrl = siteLinks.docs['en' === locale ? 'en' : 'zh'],
    [scrolled, setScrolled] = React.useState(false),
    [menuOpen, setMenuOpen] = React.useState(false),
    [downloadsOpen, setDownloadsOpen] = React.useState(false),
    [wideScreen, setWideScreen] = React.useState(false),
    [heroBadgeVisible, setHeroBadgeVisible] = React.useState(true),
    heroBadgeRef = React.useRef(null);
  React.useEffect(() => {
    let e = () => {
      (setScrolled(window.scrollY > 80),
        setWideScreen(window.innerWidth >= 1560),
        heroBadgeRef.current ||
          (heroBadgeRef.current = document.querySelector(
            '[data-hero-preview-label]',
          )));
      let e = heroBadgeRef.current;
      if (e) {
        let n = e.getBoundingClientRect();
        setHeroBadgeVisible(n.bottom > 0 && n.top < window.innerHeight);
      }
    };
    e();
    let n = requestAnimationFrame(e);
    window.addEventListener('scroll', e, {
      passive: true,
    });
    window.addEventListener('resize', e, {
      passive: true,
    });
    return () => {
      (cancelAnimationFrame(n),
        window.removeEventListener('scroll', e),
        window.removeEventListener('resize', e));
    };
  }, []);
  React.useEffect(() => {
    if ((menuOpen || setDownloadsOpen(false), menuOpen))
      return (
        (document.documentElement.style.overflow = 'hidden'),
        (document.body.style.overflow = 'hidden'),
        () => {
          ((document.documentElement.style.overflow = ''),
            (document.body.style.overflow = ''));
        }
      );
  }, [menuOpen]);
  return (
    <React.Fragment>
      {
        <div className="ds-header-wrapper">
          {
            <motion.div
              initial={{
                maxWidth: 1280,
                paddingLeft: 0,
                paddingRight: 0,
              }}
              animate={{
                maxWidth: scrolled ? (wideScreen ? 1180 : 980) : 1280,
                paddingLeft: scrolled ? 16 : 0,
                paddingRight: scrolled ? 6 : 0,
              }}
              transition={{
                type: 'spring',
                stiffness: 180,
                damping: 28,
              }}
              className={'ds-header-bar '.concat(scrolled ? 'is-scrolled' : '')}
            >
              {
                <LocalizedLink
                  href="/harness"
                  className="flex items-center gap-[8px] min-w-0 text-[var(--ds-color-brand-medium-reverse)]"
                >
                  {
                    <span className="shrink-0 inline-flex">
                      {<HeaderLogo className="h-6 w-auto" />}
                    </span>
                  }
                  {
                    <span className="inline-flex items-center min-w-0">
                      {
                        <AnimatePresence>
                          {!heroBadgeVisible && (
                            <motion.span
                              data-header-preview-label={true}
                              className="hidden lg:inline-flex items-start min-w-0"
                              initial={{
                                opacity: 0,
                                x: -6,
                                filter: 'blur(3px)',
                              }}
                              animate={{
                                opacity: 1,
                                x: 0,
                                filter: 'blur(0px)',
                              }}
                              exit={{
                                opacity: 0,
                                x: -6,
                                filter: 'blur(3px)',
                              }}
                              transition={{
                                duration: 0.35,
                                ease: [0.4, 0, 0.2, 1],
                              }}
                            >
                              {
                                <PreviewBadge label={t('harnessPreviewLabel')}>
                                  {t('harnessPreviewBadge')}
                                </PreviewBadge>
                              }
                            </motion.span>
                          )}
                        </AnimatePresence>
                      }
                    </span>
                  }
                </LocalizedLink>
              }
              {
                <div className="hidden md:flex shrink-0 items-center gap-ds-2 lg:gap-ds-4">
                  {!scrolled && (
                    <div className="ml-ds-1 shrink-0 whitespace-nowrap">
                      {<LanguageSwitcher />}
                    </div>
                  )}
                  {scrolled && (
                    <React.Fragment>
                      {
                        <Button
                          as="a"
                          variant="secondary"
                          size="xs"
                          className="harness-github-button min-w-[80px] shrink-0"
                          href="https://github.com/JinPenG-AI"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => trackInteraction('header_github')}
                        >
                          {
                            <span className="harness-button-content">
                              {
                                <svg
                                  width="15"
                                  height="15"
                                  viewBox="0 0 16 16"
                                  fill="currentColor"
                                >
                                  {
                                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                                  }
                                </svg>
                              }
                              {'GitHub'}
                            </span>
                          }
                        </Button>
                      }
                      {
                        <DemoDownload
                          label={t('harnessHeaderDownload')}
                          rentalDemo={true}
                          size="xs"
                          placement="bottom-end"
                          showIcon={false}
                          onDownload={(e) => {
                            e
                              ? trackInteraction(
                                  'macOS' === e
                                    ? 'header_download_mac'
                                    : 'header_download_win',
                                )
                              : trackInteraction('harness_header_download');
                          }}
                        />
                      }
                    </React.Fragment>
                  )}
                </div>
              }
              {
                <button
                  className="md:hidden flex items-center justify-center w-10 h-10 text-ds-primary"
                  aria-label={t('harnessOpenMenu')}
                  aria-controls="harness-mobile-menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(true)}
                >
                  {<CloseIcon size={24} />}
                </button>
              }
            </motion.div>
          }
        </div>
      }
      {
        <div
          id="harness-mobile-menu"
          className={'ds-mobile-menu '.concat(menuOpen ? 'is-open' : '')}
          aria-hidden={!menuOpen}
          style={{
            visibility: menuOpen ? 'visible' : 'hidden',
          }}
        >
          {
            <div className="ds-mobile-menu-header">
              {
                <LocalizedLink
                  href="/harness"
                  className="flex items-center text-[var(--ds-color-brand-medium-reverse)]"
                  onClick={() => setMenuOpen(false)}
                >
                  {<HeaderLogo className="h-6 w-auto" />}
                </LocalizedLink>
              }
              {
                <button
                  className="flex items-center justify-center w-10 h-10 text-ds-primary"
                  aria-label={t('harnessCloseMenu')}
                  onClick={() => setMenuOpen(false)}
                >
                  {<MenuIcon size={24} />}
                </button>
              }
            </div>
          }
          {
            <nav className="ds-mobile-menu-body">
              {
                <a
                  href="#demo-request"
                  className="ds-mobile-menu-item"
                  aria-haspopup="dialog"
                  aria-controls="demo-request"
                  onClick={(e) => {
                    (e.preventDefault(),
                      setMenuOpen(false),
                      document.dispatchEvent(
                        new CustomEvent('rentalos:request-demo', {
                          detail: {
                            trigger: e.currentTarget,
                          },
                        }),
                      ));
                  }}
                >
                  {t('harnessDemoAction')}
                </a>
              }
              {
                <div
                  className="harness-mobile-download"
                  data-open={downloadsOpen}
                >
                  {
                    <button
                      type="button"
                      className="ds-mobile-menu-item harness-mobile-download-trigger"
                      aria-expanded={downloadsOpen}
                      aria-controls="harness-mobile-download-options"
                      onClick={() => setDownloadsOpen((e) => !e)}
                    >
                      {t('harnessHeroDownloadDesktop')}
                      {
                        <span
                          aria-hidden="true"
                          className="harness-mobile-download-arrow"
                        >
                          {<ChevronDown />}
                        </span>
                      }
                    </button>
                  }
                  {
                    <div
                      id="harness-mobile-download-options"
                      className="harness-mobile-download-panel"
                      aria-hidden={!downloadsOpen}
                    >
                      {
                        <div className="harness-mobile-download-clip">
                          {
                            <div className="harness-mobile-download-options">
                              {downloadOptions.map((n) => (
                                <a
                                  key={n.platform}
                                  tabIndex={downloadsOpen ? undefined : -1}
                                  href={n.href}
                                  aria-disabled={true}
                                  onClick={(e) => e.preventDefault()}
                                >
                                  {<span>{t(n.labelKey)}</span>}
                                  {
                                    <span className="rentalos-development">
                                      {t('harnessDownloadDevelopment')}
                                    </span>
                                  }
                                </a>
                              ))}
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
              {
                <a
                  href="https://github.com/JinPenG-AI"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ds-mobile-menu-item"
                  onClick={() => {
                    (trackInteraction('header_github'), setMenuOpen(false));
                  }}
                >
                  {'GitHub'}
                </a>
              }
              {
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ds-mobile-menu-item"
                  onClick={() => setMenuOpen(false)}
                >
                  {t('harnessCtaDocs')}
                </a>
              }
              {
                <a
                  href={siteLinks.plugins}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ds-mobile-menu-item"
                  onClick={() => setMenuOpen(false)}
                >
                  {t('harnessCtaPlugins')}
                </a>
              }
              {
                <a
                  href={siteLinks.paper}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ds-mobile-menu-item"
                  onClick={() => setMenuOpen(false)}
                >
                  {t('harnessCtaPaper')}
                </a>
              }
            </nav>
          }
          {<div className="flex py-ds-4 pl-ds-5">{<LanguageSwitcher />}</div>}
        </div>
      }
    </React.Fragment>
  );
}
