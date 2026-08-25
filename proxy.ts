/**
 * Refreshes the Supabase session on every request.
 *
 * WHY this exists at all: Server Components cannot write cookies, so a token
 * that expires mid-visit would leave the user silently signed out on their next
 * navigation. This is the one place in a Next.js app that can both read the
 * request cookies and write them onto the response.
 *
 * AI-NOTE: this was `middleware.ts` until Next.js 16 renamed the convention to
 *          `proxy.ts` with an exported `proxy` function. Behaviour is identical;
 *          the old name still works but warns on every build.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/sign-in', '/api/health'];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_ANON_KEY'];
  // Without configuration there is no session to refresh. Let the page render
  // and fail with its own message rather than 500ing from the middleware.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Revalidates the token and rotates the cookie when it is close to expiry.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/sign-in';
    return NextResponse.redirect(signIn);
  }

  return response;
}

export const config = {
  // Everything except static assets. The auth check itself lives above, so this
  // only needs to exclude things that can never need a session.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
