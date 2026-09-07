import { redirect } from 'next/navigation';

// The middleware already sends signed-out visitors to /sign-in, so this only
// has to pick the landing page for someone who is signed in. Hub, per ADR 0012:
// coming back to the app, the first question is "where am I up to" — the
// streak, the XP, the challenges — not "what did I do in March".
export default function Home() {
  redirect('/hub');
}
