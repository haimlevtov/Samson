'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerDb } from '@/src/db/server';

export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  const db = await createServerDb();
  const { error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    // WHY the message is passed through rather than replaced with something
    // generic: this build has published fixture credentials, so there is no
    // account enumeration to protect against, and "Invalid login credentials"
    // versus "database unreachable" is the difference between a five-second fix
    // and a confused demo.
    redirect(`/sign-in?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath('/', 'layout');
  redirect('/hub');
}

export async function signOut(): Promise<void> {
  const db = await createServerDb();
  await db.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/sign-in');
}
