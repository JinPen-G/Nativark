'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
export function SiteFooter() {
  const t = useTranslations('Harness.Index');
  const locale = useLocale();
  return (
    <footer className="ds-container pb-ds-6">
      {<div className="w-full h-px bg-ds-border-subtle" />}
      {
        <div className="flex flex-col items-center gap-ds-4 pt-ds-5 xl:grid xl:grid-cols-[1fr_auto_1fr] xl:items-center">
          {
            <div className="flex items-center gap-ds-6 xl:justify-self-start">
              {
                <a
                  href="https://x.com/_JinPen"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rentalos-footer-social text-ds-secondary hover:text-ds-primary transition-colors"
                  aria-label="X"
                  title="X"
                >
                  {
                    <svg
                      width={20}
                      height={20}
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden={true}
                      focusable="false"
                    >
                      {
                        <path d="M18.205 2.25h3.308l-7.227 8.26l8.502 11.24H16.13l-5.214-6.817L4.95 21.75H1.64l7.73-8.835L1.215 2.25H8.04l4.713 6.231zm-1.161 17.52h1.833L7.045 4.126H5.078z" />
                      }
                    </svg>
                  }
                </a>
              }
              {
                <a
                  href="https://github.com/JinPenG-AI"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rentalos-footer-social text-ds-secondary hover:text-ds-primary transition-colors"
                  aria-label="GitHub"
                  title="GitHub"
                >
                  {
                    <svg
                      width={20}
                      height={20}
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      aria-hidden={true}
                      focusable="false"
                    >
                      {
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                      }
                    </svg>
                  }
                </a>
              }
            </div>
          }
          {
            <p className="ds-text-caption text-ds-description text-center">
              {'Powered by PenG-AI · All rights reserved.'}
            </p>
          }
          {
            <nav
              aria-label={t('harnessFooterPolicyLinks')}
              className="flex flex-wrap items-center justify-center gap-x-ds-3 gap-y-ds-2 xl:justify-self-end"
            >
              {
                <span
                  role="link"
                  aria-disabled={true}
                  className="ds-text-caption text-ds-primary whitespace-nowrap"
                >
                  {t('harnessFooterPrivacyPolicy')}
                </span>
              }
              {
                <span
                  aria-hidden={true}
                  className="ds-text-caption text-ds-description"
                >
                  {'\xb7'}
                </span>
              }
              {
                <span
                  role="link"
                  aria-disabled={true}
                  className="ds-text-caption text-ds-primary whitespace-nowrap"
                >
                  {t('harnessFooterTermsOfUse')}
                </span>
              }
            </nav>
          }
        </div>
      }
    </footer>
  );
}
