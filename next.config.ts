import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,

  /*
   * The dev overlay's floating badge sits bottom-left, which since ADR 0012 is
   * on top of the History tab, and on top of the rest timer's "−15" during a
   * session. Both are things you tap. It is a development-only affordance
   * covering two production controls, so it goes.
   *
   * WHY off rather than moved: every corner is occupied on a 375px screen —
   * the session bar owns the top, the tab bar owns the bottom — and the
   * information it shows (route type, build activity) is in the terminal.
   */
  devIndicators: false,
};

export default config;
