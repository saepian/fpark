import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold text-white mb-8">이용약관</h1>

      <div className="space-y-8 text-slate-300 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">제1조 (목적)</h2>
          <p>본 약관은 FINANCE PARK(fpark.com, 이하 "서비스")가 제공하는
          시장 데이터 및 AI 분석 서비스의 이용 조건을 규정합니다.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">제2조 (서비스 내용)</h2>
          <ul className="list-disc list-inside space-y-1 text-slate-400">
            <li>매일 갱신되는 시장 시세 및 차트 정보 제공</li>
            <li>AI 기반 종목 분석 리포트</li>
            <li>금융 뉴스 수집 및 AI 요약</li>
            <li>시장 지수 및 환율 정보</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">제3조 (투자 면책조항)</h2>
          <p className="text-amber-400/80 font-medium">
            본 서비스의 모든 정보는 투자 참고용이며 투자 권유가 아닙니다.
            투자는 원금 손실의 위험이 있으며, 투자 결정과 그 결과에 대한
            책임은 전적으로 이용자 본인에게 있습니다.
            FINANCE PARK는 제공된 정보의 정확성을 보장하지 않으며,
            이로 인한 손해에 대해 책임을 지지 않습니다.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">제4조 (저작권)</h2>
          <p>본 서비스의 콘텐츠(AI 분석, 디자인, 코드 등)의 저작권은
          FINANCE PARK에 있으며, 무단 복제 및 배포를 금지합니다.
          뉴스 콘텐츠의 저작권은 각 언론사에 있습니다.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">제5조 (서비스 변경 및 중단)</h2>
          <p>FINANCE PARK는 서비스 내용을 변경하거나 중단할 수 있으며,
          이로 인한 손해에 대해 별도의 보상을 하지 않습니다.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">제6조 (유료 서비스 및 환불 정책)</h2>
          {/* TODO: 결제대행사(PG/MoR) 확정 시 결제 방식 조항 재검토 필요 —
              해외 MoR 사용 시 '빌링키' 개념이 아닌 구독 관리 방식으로 변경될 수 있음 */}
          <div className="space-y-3 text-slate-400">
            <p><span className="text-slate-300 font-medium">결제 방식:</span> 구독 플랜(Basic / Pro)은 최초 결제 시 빌링키를 발급하여 매월 자동 결제됩니다.</p>
            <p><span className="text-slate-300 font-medium">해지:</span> 마이페이지 &gt; 구독 취소 메뉴에서 언제든지 구독을 해지할 수 있습니다.</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>결제일로부터 7일 이내로 환불 대상에 해당하는 경우: 환불 처리와 동시에 서비스 이용이 즉시 중단됩니다.</li>
              <li>결제일로부터 7일이 지나 환불 대상이 아닌 경우: 다음 결제일부터 자동 결제가 중단되며, 그 전까지는 서비스를 계속 이용할 수 있습니다.</li>
            </ul>
            <p><span className="text-slate-300 font-medium">환불 기준:</span></p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>결제일로부터 <span className="text-slate-300">7일 이내</span>이고 서비스를 이용하지 않은 경우: 전액 환불</li>
              <li>결제일로부터 7일 이내이나 서비스를 이용한 경우: 이용 일수에 해당하는 금액을 제외하고 환불</li>
              <li>결제일로부터 7일 초과: 환불 불가 (단, 서비스 중대한 결함으로 인한 장애 시 협의 가능)</li>
            </ul>
            <p className="text-[13px]">
              환불 금액은 경과일수와 실제 이용 실적(분석 이용 횟수) 중 더 큰 차감 비율을 적용하여 계산됩니다.
              자세한 계산 방식은{' '}
              <Link href="/pricing#faq-refund-calc" className="text-indigo-400 hover:underline">요금제 페이지 FAQ</Link>를 참고해주세요.
            </p>
            <p><span className="text-slate-300 font-medium">환불 신청:</span> 마이페이지 &gt; 구독 취소 메뉴에서 신청하면 위 기준에 따라 환불 금액이 자동으로 계산되어 접수됩니다. 그 외 문의사항은 아래 이메일 또는 연락처로 결제 정보(이름, 이메일, 결제일)를 포함하여 문의해주세요.</p>
            <p>이메일: <a href="mailto:saepian2@gmail.com" className="text-indigo-400 hover:underline">saepian2@gmail.com</a>&ensp;|&ensp;전화: 010-2198-9685</p>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">제7조 (문의)</h2>
          <p>서비스 관련 문의: <a href="mailto:saepian2@gmail.com"
            className="text-indigo-400 hover:underline">saepian2@gmail.com</a></p>
          <p className="mt-1 text-slate-500">시행일: 2026년 7월 7일</p>
        </section>
      </div>
    </div>
  )
}
