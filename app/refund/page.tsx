import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'FPARK | 환불정책',
  description: 'FPARK 서비스의 환불 기준 및 환불 절차를 안내합니다.',
  alternates: {
    canonical: 'https://fpark.com/refund',
  },
  openGraph: {
    title: 'FPARK | 환불정책',
    description: 'FPARK 서비스의 환불 기준 및 환불 절차를 안내합니다.',
    url: 'https://fpark.com/refund',
  },
};

const REFUND_EMAIL = 'saepian2@gmail.com';
const LAST_UPDATED = '2026년 7월 7일';

const webPageJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: '환불정책',
  alternateName: 'Refund Policy',
  description: 'FPARK 서비스의 환불 기준 및 환불 절차를 안내합니다.',
  url: 'https://fpark.com/refund',
  dateModified: '2026-07-07',
  inLanguage: 'ko-KR',
  isPartOf: {
    '@type': 'WebSite',
    name: 'FINANCE PARK',
    url: 'https://fpark.com',
  },
};

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: '홈', item: 'https://fpark.com' },
    { '@type': 'ListItem', position: 2, name: '환불정책', item: 'https://fpark.com/refund' },
  ],
};

export default function RefundPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">환불정책</h1>
        <p className="mt-4 text-slate-500 text-sm">최종 수정일 : {LAST_UPDATED}</p>
      </div>

      <div className="space-y-8 text-slate-300 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">1. 적용 범위</h2>
          <p>본 환불정책은 FPARK에서 제공하는 모든 디지털 서비스 및 구독 상품에 적용됩니다.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">2. 구독 상품 환불</h2>
          <p>아래 조건을 모두 충족하는 경우 전액 환불이 가능합니다.</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-slate-400">
            <li>결제일로부터 7일 이내</li>
            <li>서비스를 사용하지 않은 경우</li>
          </ul>
          <p className="mt-3">서비스를 이미 사용한 경우에는 사용 기간에 해당하는 금액을 제외한 나머지 금액을 환불합니다.</p>
          <p className="mt-3 text-slate-400 text-[13px]">
            환불 금액은 경과일수와 실제 이용 실적(분석 이용 횟수) 중 더 큰 차감 비율을 적용하여 계산됩니다.
            자세한 계산 방식은{' '}
            <Link href="/pricing#faq-refund-calc" className="text-indigo-400 hover:underline">요금제 페이지 FAQ</Link>를 참고해주세요.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">3. 1회 이용권</h2>
          <p>기업 분석 및 포트폴리오 분석과 같은 1회 이용권은 아래 조건을 모두 충족하는 경우 전액 환불이 가능합니다.</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-slate-400">
            <li>미사용 상태</li>
            <li>구매일로부터 7일 이내</li>
          </ul>
          <p className="mt-3">이미 사용한 이용권은 환불되지 않습니다.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">4. 자동결제 해지</h2>
          <p>구독은 마이페이지 &gt; 구독 취소 메뉴에서 언제든지 해지할 수 있습니다.</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-slate-400">
            <li>결제일로부터 7일 이내로 환불 대상에 해당하는 경우, 환불 처리와 동시에 서비스 이용이 즉시 중단됩니다.</li>
            <li>결제일로부터 7일이 지나 환불 대상이 아닌 경우, 다음 결제일부터 자동결제가 중단되며 그 전까지는 서비스를 계속 이용할 수 있습니다.</li>
          </ul>
          <p className="mt-2">이미 결제된 기간은 위 환불 기준에 따라 처리됩니다.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">5. 환불 신청</h2>
          <p>마이페이지 &gt; 구독 취소 메뉴에서 취소를 신청하면 위 환불 기준에 따라 환불 금액이 자동으로 계산되어 접수됩니다.</p>
          <p className="mt-3">그 외 문의사항은 아래 이메일로 연락해주세요.</p>
          <p className="mt-2">
            <a href={`mailto:${REFUND_EMAIL}`} className="text-indigo-400 hover:underline">{REFUND_EMAIL}</a>
          </p>
          <p className="mt-3">이메일 문의 시 아래 내용을 포함해주세요.</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-slate-400">
            <li>이름</li>
            <li>가입 이메일</li>
            <li>결제일</li>
            <li>환불 사유</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">6. 환불 처리 기간</h2>
          <p>환불 승인 후 영업일 기준 3~7일 이내 결제수단으로 환불됩니다.</p>
          <p className="mt-2 text-slate-400">카드사 또는 결제사 정책에 따라 실제 입금일은 달라질 수 있습니다.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">7. 예외사항</h2>
          <p>다음 경우에는 환불이 제한될 수 있습니다.</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-slate-400">
            <li>서비스 이용 기록이 있는 경우</li>
            <li>정책을 악용한 반복 환불</li>
            <li>부정 사용이 확인된 경우</li>
            <li>관계 법령상 환불이 제한되는 경우</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">8. 문의</h2>
          <p>문의 이메일: <a href={`mailto:${REFUND_EMAIL}`} className="text-indigo-400 hover:underline">{REFUND_EMAIL}</a></p>
        </section>
      </div>
    </div>
  );
}
