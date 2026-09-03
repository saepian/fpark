'use client';

import { useState, useEffect } from 'react';

// 기업분석(stock_diagnosis)/포트폴리오분석(portfolio_diagnosis) 공용 "저장" 상태 관리.
// reportId는 방금 생성된 리포트라면 SSE done 이벤트로 받은 id, savedId로 진입했다면
// 그 id 그대로 — 둘 다 원본 테이블(stock_diagnosis/portfolio_diagnosis)의 실제 행 id다.
// 페이지에서 한 번만 호출해 saved/toggle을 위·아래 두 SaveReportButton에 그대로 내려주면
// 두 버튼이 항상 같은 상태를 보여준다(2026-09-03 설계).
export function useSaveReport(
  reportId: string | null | undefined,
  reportType: 'stock' | 'portfolio',
  initialSaved = false,
  initialSavedReportId: string | null = null,
) {
  const [saved, setSaved] = useState(initialSaved);
  const [savedReportId, setSavedReportId] = useState<string | null>(initialSavedReportId);
  const [saving, setSaving] = useState(false);

  // reportId가 바뀌면(새 리포트를 생성했거나 다른 저장 리포트로 이동) 초기 상태로 리셋.
  useEffect(() => {
    setSaved(initialSaved);
    setSavedReportId(initialSavedReportId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const toggle = async () => {
    if (!reportId || saving) return;
    setSaving(true);
    try {
      if (saved && savedReportId) {
        const res = await fetch(`/api/saved-reports/${savedReportId}`, { method: 'DELETE' });
        if (res.ok) {
          setSaved(false);
          setSavedReportId(null);
        }
      } else {
        const res = await fetch('/api/saved-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportType, sourceId: reportId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.id) {
          setSaved(true);
          setSavedReportId(data.id);
        }
      }
    } catch {
      // 네트워크 오류 — 조용히 무시(버튼 상태는 이전 그대로 유지, 재시도는 사용자가 다시 클릭)
    } finally {
      setSaving(false);
    }
  };

  return { saved, saving, toggle };
}
