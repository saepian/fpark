import { redirect } from 'next/navigation';
import AppShell from '../components/AppShell';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; refresh?: string }>;
}) {
  const { code, refresh } = await searchParams;
  if (code && !refresh) {
    redirect(`/auth/callback?code=${code}`);
  }

  return <AppShell />;
}
