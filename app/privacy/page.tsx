export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold text-white mb-8">개인정보처리방침</h1>

      <div className="space-y-8 text-slate-300 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">1. 수집하는 개인정보</h2>
          <p>FINANCE PARK(fpark.com)는 서비스 제공을 위해 다음과 같은 정보를 수집할 수 있습니다:</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-slate-400">
            <li>서비스 이용 기록, 접속 로그, 쿠키</li>
            <li>IP 주소, 브라우저 종류, 운영체제</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">2. 개인정보 수집 목적</h2>
          <ul className="list-disc list-inside space-y-1 text-slate-400">
            <li>서비스 제공 및 운영</li>
            <li>서비스 개선 및 신규 기능 개발</li>
            <li>통계 분석 및 서비스 품질 향상</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">3. 개인정보 보유 기간</h2>
          <p>수집된 개인정보는 서비스 이용 종료 시 즉시 파기하며,
          법령에 의해 보존이 필요한 경우 해당 기간 동안 보관합니다.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">4. 쿠키 사용</h2>
          <p>본 서비스는 Google Analytics 및 Google AdSense를 통해
          쿠키를 사용할 수 있습니다. 브라우저 설정에서 쿠키를 거부할 수 있으나,
          일부 서비스 이용이 제한될 수 있습니다.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">5. 제3자 제공</h2>
          <p>수집된 개인정보는 법령에 의한 경우를 제외하고
          제3자에게 제공하지 않습니다.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">6. 투자 정보 면책조항</h2>
          <p className="text-amber-400/80">
            본 사이트에서 제공하는 모든 투자 정보 및 AI 분석 내용은
            참고용 자료이며, 투자 권유를 목적으로 하지 않습니다.
            투자 판단 및 그에 따른 손익은 투자자 본인에게 있으며,
            FINANCE PARK는 이에 대한 책임을 지지 않습니다.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">7. 문의</h2>
          <p>개인정보 관련 문의: <a href="mailto:saepian2@gmail.com"
            className="text-indigo-400 hover:underline">saepian2@gmail.com</a></p>
          <p className="mt-1 text-slate-500">최종 수정일: 2026년 6월 24일</p>
        </section>
      </div>
    </div>
  )
}
