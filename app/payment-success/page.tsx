import type { Metadata } from 'next';
import PaymentSuccessClient from './PaymentSuccessClient';

export const metadata: Metadata = {
  title: '결제 완료 | fpark',
  description: '결제가 완료되었습니다.',
};

export default function PaymentSuccessPage() {
  return <PaymentSuccessClient />;
}
