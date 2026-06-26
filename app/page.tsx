import { redirect } from 'next/navigation';
import AppShell from '../components/AppShell';

export default async function Page({ searchParams }: { searchParams: { code?: string } }) {
  if (searchParams.code) {
    redirect(`/auth/callback?code=${searchParams.code}`);
  }

  return <AppShell />;
}
