'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import * as React from 'react';
export function Heading(e) {
  let { as: s = 'h2', className: n, children: a, ...i } = e;
  return React.createElement(
    s,
    {
      ...i,
      className: ['harness-heading', n].filter(Boolean).join(' '),
    },
    (function e(s) {
      return React.Children.map(s, (s) =>
        'string' == typeof s || 'number' == typeof s
          ? String(s)
              .split(RegExp('([\\p{Script=Latin}\\p{M}\\p{N}]+)', 'u'))
              .map((e, s) =>
                s % 2 == 1 ? (
                  <span key={s} className="harness-heading-latin">
                    {e}
                  </span>
                ) : (
                  e
                ),
              )
          : React.isValidElement(s) && undefined !== s.props.children
            ? React.cloneElement(s, {}, e(s.props.children))
            : s,
      );
    })(a),
  );
}
