import { redirect } from 'next/navigation';

// The middleware already sends signed-out visitors to /sign-in, so this only
// has to pick the landing page for someone who is signed in.
export default function Home() {
  redirect('/workouts');
}
