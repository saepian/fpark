import { redirect } from 'next/navigation';
import AppShell from '../components/AppShell';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  if (code) {
    redirect(`/auth/callback?code=${code}`);
  }

  return <AppShell />;
}
