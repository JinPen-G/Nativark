'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import * as React from 'react';
import { getResultStyles } from '../shared/styleNames.js';
import { FileIcon } from '../shared/CapabilityIcons.jsx';
import { useTranslations } from 'next-intl';
import { fileCarouselKinds } from '../shared/demoData.jsx';
import { fileKinds } from '../shared/demoData.jsx';
export function rentalResult(n, selected, picked, setPicked) {
  const h = React.createElement,
    c = getResultStyles();
  const names = [
    'word',
    'excel',
    'pdf',
    'html',
    'typescript',
    'python',
    'markdown',
  ];
  const kind = names.includes(selected) ? selected : 'pdf';
  const quote = kind === 'pdf';
  const checklist = kind === 'word' || kind === 'typescript';
  const report = kind === 'excel' || kind === 'python' || kind === 'markdown';
  const facts = quote
    ? [
        [n('customer'), n('customerValue')],
        [n('period'), n('periodValue')],
        [n('rental'), '¥1,200'],
        [n('deposit'), '¥2,000'],
        [n('total'), '¥3,200'],
      ]
    : [];
  return h(
    'div',
    {
      className: c.diffPanel + ' rentalos-result-panel',
    },
    h(
      'div',
      {
        className: c.tabBar,
      },
      h(
        'div',
        {
          className: c.activeTab,
        },
        h(
          'span',
          {
            className: c.tabTitle,
          },
          n('reviewTab'),
        ),
      ),
      picked &&
        h(
          'button',
          {
            type: 'button',
            className: 'rentalos-result-close rentalos-cap-control',
            onClick: () => setPicked(false),
          },
          n('returnList'),
        ),
    ),
    h(
      'div',
      {
        className: c.diffHeader,
      },
      h(FileIcon, {
        kind,
      }),
      h(
        'span',
        {
          className: c.filePath,
        },
        n(kind + 'Name'),
      ),
    ),
    h(
      'div',
      {
        className: 'rentalos-result-content',
      },
      h(
        'p',
        {
          className: 'rentalos-cap-note',
        },
        n('sample'),
      ),
      h(
        'h4',
        null,
        quote
          ? n('item')
          : checklist
            ? n('checklist')
            : report
              ? n('reportTitle')
              : n('detailsTitle'),
      ),
      quote
        ? h(
            'dl',
            null,
            ...facts.map(([label, value]) =>
              h(
                'div',
                {
                  key: label,
                },
                h('dt', null, label),
                h('dd', null, value),
              ),
            ),
          )
        : h(
            'ul',
            null,
            ...[1, 2, 3].map((index) =>
              h(
                'li',
                {
                  key: index,
                },
                n((checklist ? 'check' : report ? 'report' : 'detail') + index),
              ),
            ),
          ),
    ),
  );
}
export function DeliverablesDemo(e) {
  let { paused: s = false } = e,
    n = useTranslations('Harness.DeliverablesPreview'),
    a = React.useRef(null),
    [i, o] = React.useState(false),
    [rentalFile, setRentalFile] = React.useState('pdf'),
    [rentalPicked, setRentalPicked] = React.useState(false);
  React.useEffect(() => {
    let e = a.current;
    if (!e) return;
    let s = new IntersectionObserver(
      (e) => {
        let [s] = e;
        return o(s.isIntersecting);
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
      ref={a}
      className={getResultStyles().frame}
      data-rental-capability="deliverables"
      data-picked={rentalPicked}
      data-running={i && !s && !rentalPicked}
      aria-label={n('accessibleLabel')}
    >
      {
        <div className={getResultStyles().composition}>
          {
            <div className={getResultStyles().fileCarousel}>
              {
                <div className={getResultStyles().fileTrack}>
                  {fileCarouselKinds.map((e, s) => (
                    <button
                      key={''.concat(e, '-').concat(s)}
                      type="button"
                      onClick={() => {
                        setRentalFile(e);
                        setRentalPicked(true);
                      }}
                      aria-label={n('preview') + ' ' + n(e + 'Name')}
                      className={
                        getResultStyles().fileCard + ' rentalos-cap-control'
                      }
                      style={{
                        '--file-phase': s % fileKinds.length,
                      }}
                    >
                      {
                        <span className={getResultStyles().iconWell}>
                          {<FileIcon kind={e} />}
                        </span>
                      }
                      {
                        <span className={getResultStyles().fileCopy}>
                          {
                            <span className={getResultStyles().fileName}>
                              {n(''.concat(e, 'Name'))}
                            </span>
                          }
                          {
                            <span className={getResultStyles().fileMeta}>
                              {n(''.concat(e, 'Type'))}
                            </span>
                          }
                        </span>
                      }
                    </button>
                  ))}
                </div>
              }
            </div>
          }
          {rentalResult(n, rentalFile, rentalPicked, setRentalPicked)}
        </div>
      }
    </figure>
  );
}
