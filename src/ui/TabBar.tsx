'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { isCurrent } from './tabs';

/**
 * The five tabs — ADR 0012.
 *
 * Bottom, not top: docs/specs/mobile-interface.md §0. The thumb is at the
 * bottom of the phone and the other hand is holding something heavy.
 *
 * Order is the one the product owner gave, read right to left — Profile,
 * Workout, Hub, Coach, History — which is this array reversed. It is written
 * left to right here because that is the reading order of the markup, and a
 * screen reader follows the markup.
 */
interface Tab {
  href: string;
  label: string;
  icon: ReactNode;
}

/*
 * WHY inline SVG rather than an icon package: five icons is not a dependency,
 * and every icon set worth having ships a few hundred kilobytes to deliver
 * them. These are drawn on a 24-grid with a 2px stroke and inherit `currentColor`
 * so the active state is one CSS rule rather than five swapped assets.
 */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...stroke}>
      {children}
    </svg>
  );
}

const TABS: Tab[] = [
  {
    href: '/history',
    label: 'History',
    // A clock turned back — the past, not the schedule.
    icon: (
      <Icon>
        <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
        <path d="M3 4v4h4" />
        <path d="M12 8v4.4l2.8 1.7" />
      </Icon>
    ),
  },
  {
    href: '/coach',
    label: 'Coach',
    icon: (
      <Icon>
        <path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5v-3.5H6.5A2.5 2.5 0 0 1 4 14.5v-7A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5Z" />
        <path d="M9 10h6M9 13h3" />
      </Icon>
    ),
  },
  {
    href: '/hub',
    label: 'Hub',
    icon: (
      <Icon>
        <path d="M8 4h8v3a4 4 0 0 1-8 0Z" />
        <path d="M8 5H5.5v1.5A3.5 3.5 0 0 0 9 10M16 5h2.5v1.5A3.5 3.5 0 0 1 15 10" />
        <path d="M12 11v4M9 20h6M10.5 15h3l.7 5h-4.4Z" />
      </Icon>
    ),
  },
  {
    href: '/workout',
    label: 'Workout',
    // A barbell: the thing the tab is for.
    icon: (
      <Icon>
        <path d="M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12" />
      </Icon>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: (
      <Icon>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
      </Icon>
    ),
  },
];

/** Signed out, every tab redirects to the page you are already on. */
const HIDDEN_ON = ['/sign-in'];

export function TabBar() {
  const pathname = usePathname();
  if (HIDDEN_ON.some((path) => isCurrent(pathname, path))) return null;

  return (
    <nav className="tabbar" aria-label="Sections">
      {TABS.map((tab) => {
        const current = isCurrent(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tab ${current ? 'tab-on' : ''}`}
            // Colour alone is not a state. This is what a screen reader reads.
            aria-current={current ? 'page' : undefined}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
