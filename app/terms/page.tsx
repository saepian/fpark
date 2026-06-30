export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold text-white mb-8">이용약관</h1>

      <div className="space-y-8 text-slate-300 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">제1조 (목적)</h2>
          <p>본 약관은 FINANCE PARK(fpark.com, 이하 "서비스")가 제공하는
          주식 정보 및 AI 분석 서비스의 이용 조건을 규정합니다.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">제2조 (서비스 내용)</h2>
          <ul className="list-disc list-inside space-y-1 text-slate-400">
            <li>실시간 주식 시세 및 차트 정보 제공</li>
            <li>AI 기반 종목 분석 리포트</li>
            <li>금융 뉴스 수집 및 AI 요약</li>
            <li>시장 지수 및 환율 정보</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">제3조 (투자 면책조항)</h2>
          <p className="text-amber-400/80 font-medium">
            본 서비스의 모든 정보는 투자 참고용이며 투자 권유가 아닙니다.
            주식 투자는 원금 손실의 위험이 있으며, 투자 결정과 그 결과에 대한
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
          <div className="space-y-3 text-slate-400">
            <p><span className="text-slate-300 font-medium">결제 방식:</span> 구독 플랜(Basic / Pro)은 최초 결제 시 빌링키를 발급하여 매월 자동 결제됩니다.</p>
            <p><span className="text-slate-300 font-medium">해지:</span> 마이페이지에서 언제든지 구독을 해지할 수 있으며, 해지 즉시 다음 달 자동 결제가 중단됩니다. 해지 후 현재 결제 기간이 끝날 때까지 서비스를 계속 이용할 수 있습니다.</p>
            <p><span className="text-slate-300 font-medium">환불 기준:</span></p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>결제일로부터 <span className="text-slate-300">7일 이내</span>이고 서비스를 이용하지 않은 경우: 전액 환불</li>
              <li>결제일로부터 7일 이내이나 서비스를 이용한 경우: 이용 일수에 해당하는 금액을 제외하고 환불</li>
              <li>결제일로부터 7일 초과: 환불 불가 (단, 서비스 중대한 결함으로 인한 장애 시 협의 가능)</li>
            </ul>
            <p><span className="text-slate-300 font-medium">환불 신청:</span> 아래 이메일 또는 연락처로 결제 정보(이름, 이메일, 결제일)를 포함하여 문의해주세요. 영업일 기준 3일 이내 처리됩니다.</p>
            <p>이메일: <a href="mailto:ad@fpark.com" className="text-indigo-400 hover:underline">ad@fpark.com</a>&ensp;|&ensp;전화: 010-2198-9685</p>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">제7조 (문의)</h2>
          <p>서비스 관련 문의: <a href="mailto:ad@fpark.com"
            className="text-indigo-400 hover:underline">ad@fpark.com</a></p>
          <p className="mt-1 text-slate-500">시행일: 2026년 6월 24일</p>
        </section>
      </div>
    </div>
  )
}
