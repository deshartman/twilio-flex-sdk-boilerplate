import { redirect } from 'next/navigation';

// No landing page — `/` sends agents straight to sign-in, which routes to
// /agent-desktop on success.
export default function Home() {
  redirect('/login');
}
