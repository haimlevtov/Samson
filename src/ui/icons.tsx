/**
 * Every icon the app draws outside the tab bar — ADR 0033 §1.
 *
 * Copied from Lucide (https://lucide.dev), ISC licence:
 *   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
 *   part of Feather (MIT). All other copyright (c) for Lucide are held by
 *   Lucide Contributors 2022.
 *   Permission to use, copy, modify, and/or distribute this software for any
 *   purpose with or without fee is hereby granted, provided that the above
 *   copyright notice and this permission notice appear in all copies.
 *
 * WHY a module of element data and not an icon package: the reasoning
 * `src/ui/TabBar.tsx` gives for its five holds for this set — a few dozen glyphs
 * is not a dependency, and no page should ask a third party how to draw itself.
 *
 * INVARIANT: every glyph is on Lucide's 24-grid with a 2px round stroke, and
 *            `Icon` sets those once. An icon from another set breaks the one
 *            visual rhythm this and the tab bar share.
 *
 * AI-NOTE: `IconName` is the keys of this object, so a misspelt name is a
 *          compile error rather than an empty square. Adding an icon is adding
 *          its elements here, copied from Lucide, and nothing else.
 */

type IconNode =
  | readonly ['path', { readonly d: string }]
  | readonly ['circle', { readonly cx: number; readonly cy: number; readonly r: number }]
  | readonly [
      'rect',
      {
        readonly width: number;
        readonly height: number;
        readonly x: number;
        readonly y: number;
        readonly rx?: number;
        readonly ry?: number;
      },
    ];

const ICONS = {
  'arrow-down-to-line': [['path', { d: 'M12 17V3m-6 8l6 6l6-6m1 10H5' }]],
  'arrow-up-from-line': [['path', { d: 'm18 9l-6-6l-6 6m6-6v14m-7 4h14' }]],
  bed: [['path', { d: 'M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9' }]],
  cake: [
    ['path', { d: 'M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8' }],
    [
      'path',
      {
        d: 'M4 16s.5-1 2-1s2.5 2 4 2s2.5-2 4-2s2.5 2 4 2s2-1 2-1M2 21h20M7 8v3m5-3v3m5-3v3M7 4h.01M12 4h.01M17 4h.01',
      },
    ],
  ],
  'calendar-check': [
    ['path', { d: 'M8 2v3m8-3v3' }],
    ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
    ['path', { d: 'M3 9h18M9 15l2 2l4-4' }],
  ],
  'calendar-days': [
    ['path', { d: 'M8 2v3m8-3v3' }],
    ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
    ['path', { d: 'M3 9h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01' }],
  ],
  'chart-line': [
    ['path', { d: 'M3 3v16a2 2 0 0 0 2 2h16' }],
    ['path', { d: 'm19 9l-5 5l-4-4l-3 3' }],
  ],
  check: [['path', { d: 'M20 6L9 17l-5-5' }]],
  'check-check': [['path', { d: 'M18 6L7 17l-5-5m20-2l-7.5 7.5L13 16' }]],
  'chevron-down': [['path', { d: 'm6 9l6 6l6-6' }]],
  'chevron-left': [['path', { d: 'm15 18l-6-6l6-6' }]],
  'chevron-right': [['path', { d: 'm9 18l6-6l-6-6' }]],
  'circle-dot': [
    ['circle', { cx: 12, cy: 12, r: 1 }],
    ['circle', { cx: 12, cy: 12, r: 10 }],
  ],
  crown: [
    [
      'path',
      {
        d: 'M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294zM5 21h14',
      },
    ],
  ],
  dumbbell: [
    [
      'path',
      {
        d: 'M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829zM2.5 21.5l1.4-1.4M20.1 3.9l1.4-1.4M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829zM9.6 14.4l4.8-4.8',
      },
    ],
  ],
  flame: [
    [
      'path',
      {
        d: 'M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0a5 5 0 0 1 1-3a1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4',
      },
    ],
  ],
  footprints: [
    [
      'path',
      {
        d: 'M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0m16 4v-2.38c0-2.12 1.03-3.12 1-5.62c-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0m-4-3h4M4 13h4',
      },
    ],
  ],
  hourglass: [
    [
      'path',
      {
        d: 'M5 22h14M5 2h14m-2 20v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2',
      },
    ],
  ],
  lock: [
    ['rect', { width: 18, height: 11, x: 3, y: 11, rx: 2, ry: 2 }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
  ],
  'lock-open': [
    ['rect', { width: 18, height: 11, x: 3, y: 11, rx: 2, ry: 2 }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 9.9-1' }],
  ],
  medal: [
    [
      'path',
      {
        d: 'M7.21 15L2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15M11 12L5.12 2.2M13 12l5.88-9.8M8 7h8',
      },
    ],
    ['circle', { cx: 12, cy: 17, r: 5 }],
    ['path', { d: 'M12 18v-2h-.5' }],
  ],
  'message-circle': [
    [
      'path',
      {
        d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092a10 10 0 1 0-4.777-4.719',
      },
    ],
  ],
  'message-circle-question-mark': [
    [
      'path',
      {
        d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092a10 10 0 1 0-4.777-4.719',
      },
    ],
    ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01' }],
  ],
  pencil: [
    [
      'path',
      {
        d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4',
      },
    ],
  ],
  pill: [
    ['path', { d: 'm10.5 20.5l10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7m-2-12l7 7' }],
  ],
  repeat: [
    ['path', { d: 'm17 2l4 4l-4 4' }],
    ['path', { d: 'M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4l4-4' }],
    ['path', { d: 'M21 13v1a4 4 0 0 1-4 4H3' }],
  ],
  route: [
    ['circle', { cx: 6, cy: 19, r: 3 }],
    ['path', { d: 'M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15' }],
    ['circle', { cx: 18, cy: 5, r: 3 }],
  ],
  'scroll-text': [
    ['path', { d: 'M15 12h-5m5-4h-5m9 9V5a2 2 0 0 0-2-2H4' }],
    [
      'path',
      {
        d: 'M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3',
      },
    ],
  ],
  'send-horizontal': [
    [
      'path',
      {
        d: 'M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904zM6 12h16',
      },
    ],
  ],
  settings: [
    [
      'path',
      {
        d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0a2.34 2.34 0 0 0 3.319 1.915a2.34 2.34 0 0 1 2.33 4.033a2.34 2.34 0 0 0 0 3.831a2.34 2.34 0 0 1-2.33 4.033a2.34 2.34 0 0 0-3.319 1.915a2.34 2.34 0 0 1-4.659 0a2.34 2.34 0 0 0-3.32-1.915a2.34 2.34 0 0 1-2.33-4.033a2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
      },
    ],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  shuffle: [
    ['path', { d: 'm18 14l4 4l-4 4m0-20l4 4l-4 4' }],
    [
      'path',
      {
        d: 'M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22M2 6h1.972a4 4 0 0 1 3.6 2.2M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45',
      },
    ],
  ],
  sparkles: [
    [
      'path',
      {
        d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594zM20 2v4m2-2h-4',
      },
    ],
    ['circle', { cx: 4, cy: 20, r: 2 }],
  ],
  star: [
    [
      'path',
      {
        d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.12 2.12 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.12 2.12 0 0 0 1.597-1.16z',
      },
    ],
  ],
  sunrise: [
    [
      'path',
      {
        d: 'M12 2v8m-7.07.93l1.41 1.41M2 18h2m16 0h2m-2.93-7.07l-1.41 1.41M22 22H2M8 6l4-4l4 4m0 12a4 4 0 0 0-8 0',
      },
    ],
  ],
  swords: [
    [
      'path',
      {
        d: 'm13 19l6-6m-4.5 4.5L3.586 6.586A2 2 0 0 1 3 5.172V3h2.172a2 2 0 0 1 1.414.586L17.5 14.5m-2.672-8.328l2.586-2.586A2 2 0 0 1 18.828 3H21v2.172a2 2 0 0 1-.586 1.414l-2.586 2.586M16 16l4 4m-1 1l2-2M5 14l4 4m-4 3l-2-2m4.5-2.5L4 20',
      },
    ],
  ],
  target: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['circle', { cx: 12, cy: 12, r: 6 }],
    ['circle', { cx: 12, cy: 12, r: 2 }],
  ],
  'trending-up': [
    ['path', { d: 'M16 7h6v6' }],
    ['path', { d: 'm22 7l-8.5 8.5l-5-5L2 17' }],
  ],
  trophy: [
    [
      'path',
      {
        d: 'M10 14.66V17a1 1 0 0 1-1 1a2 2 0 0 0-2 2v2m7-7.34V17a1 1 0 0 0 1 1a2 2 0 0 1 2 2v2m.916-12H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3M4 22h16',
      },
    ],
    ['path', { d: 'M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z' }],
    ['path', { d: 'M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3' }],
  ],
  'volume-2': [
    [
      'path',
      {
        d: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298zM16 9a5 5 0 0 1 0 6m3.364 3.364a9 9 0 0 0 0-12.728',
      },
    ],
  ],
} as const satisfies Record<string, readonly IconNode[]>;

export type IconName = keyof typeof ICONS;

/** Every name, for tests that assert an icon a mapping names actually exists. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/**
 * An icon. Decorative by default — `aria-hidden`, because every place this is
 * used puts the meaning in text beside it. A control whose only content is an
 * icon gives its NAME to the control (`aria-label`), never to the glyph.
 */
export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {ICONS[name].map(([tag, attrs], i) =>
        tag === 'path' ? (
          <path key={i} {...attrs} />
        ) : tag === 'circle' ? (
          <circle key={i} {...attrs} />
        ) : (
          <rect key={i} {...attrs} />
        )
      )}
    </svg>
  );
}
