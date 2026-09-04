// 아침 섹터 알림 메일용 섹터 그룹 정의 (2026-09-04).
// KIS 테마 마스터(theme_code.mst, 302개 테마)의 테마코드를 화이트리스트로 묶은 상수 — 종목이
// 어느 섹터에 속하는지는 lib/theme-master.ts가 이 코드 목록 × 마스터 파일로 매일 계산한다.
//
// 선정 원칙:
// - 종목 1개짜리 테마(2차전지(260), 건설사(대형)(321), 와이브로(062))와 잡탕 테마
//   ("SI, AI, ASF, 광우병"(100), 신규 상장주 연도별, 히든챔피언 등)는 제외.
// - 한 종목이 여러 테마/여러 그룹에 속할 수 있다(예: 삼성전자 → 반도체·스마트폰·디스플레이·
//   온디바이스AI). 2026-09-04 첫 실발송에서 삼성전자·SK하이닉스·삼성전기 수급이 반도체/AI/IT부품/
//   디스플레이에 그대로 중복 합산돼 상위 3개 섹터가 사실상 같은 두 종목이 되는 왜곡이 확인됨 →
//   종목당 대표 섹터 1개에만 귀속한다(resolvePrimarySector): 초대형주는 아래 수동 오버라이드 맵,
//   그 외는 "테마코드 수가 가장 적은(=가장 특정적인) 그룹 우선, 동률이면 SECTOR_GROUPS 순서" 규칙.
// - 테마명은 검토 편의를 위한 주석이며 실제 매핑은 코드로만 한다(테마명은 KIS가 바꿀 수 있음).

export interface SectorGroup {
  id: string;
  name: string;
  themeCodes: string[];
}

export const SECTOR_GROUPS: SectorGroup[] = [
  { id: 'semicon',   name: '반도체',          themeCodes: ['004', '005', '134', '231', '121', '436', '629'] }, // 반도체/반도체장비(110), 반도체재료(29), 시스템반도체(25), HBM(15), CXL(9), 유리기판(10), 3D낸드(20)
  { id: 'ai',        name: 'AI/소프트웨어',    themeCodes: ['189', '453', '700', '996'] },                      // 인공지능(22), 온디바이스AI(13), 클라우드컴퓨팅(14), 빅데이터(13)
  { id: 'battery',   name: '2차전지',          themeCodes: ['989', '986', '984', '985', '536', '302', '096'] }, // 2차전지(소재,부품,장비)(90), 2차전지(생산)(4), 2차전지(LEP)(11), 전고체배터리(17), 폐배터리(19), ESS(18), 배터리(6)
  { id: 'ev',        name: '전기차/자율주행',  themeCodes: ['109', '269', '546'] },                             // 전기차(66), 자율주행차(27), 전기차충전소(12)
  { id: 'auto',      name: '자동차',          themeCodes: ['330', '139', '097', '110', '147'] },               // 자동차부품(94), 자동차경량화(20), 하이브리드카(17), 전장(10), 타이어(4)
  { id: 'ship',      name: '조선',            themeCodes: ['076', '072'] },                                    // 조선(8), 조선기자재(32)
  { id: 'defense',   name: '방위산업',         themeCodes: ['017', '152'] },                                    // 방위산업(27), T-50고등훈련기(5)
  { id: 'space',     name: '우주항공/UAM',     themeCodes: ['168', '913', '806'] },                             // 우주(위성,발사체)(20), UAM(16), 드론(16)
  { id: 'nuclear',   name: '원자력',          themeCodes: ['992', '177', '193'] },                             // 원자력(33), 원자력발전소 해체(11), 핵융합에너지(7)
  { id: 'power',     name: '전력기기/전선',    themeCodes: ['489', '270', '117'] },                             // 전력기기(6), 전선업체(6), 스마트그리드(16)
  { id: 'renewable', name: '신재생/수소',      themeCodes: ['086', '379', '116', '344', '995'] },               // 태양광발전(27), 태양전지(12), 풍력발전(18), 수소에너지(8), 수소차(33)
  { id: 'robot',     name: '로봇/스마트공장',  themeCodes: ['066', '050'] },                                    // 로봇(34), 스마트공장(23)
  { id: 'machine',   name: '기계',            themeCodes: ['318', '966', '334'] },                             // 기계(72), 공작기계(17), 건설기계(15)
  { id: 'bio',       name: '바이오/제약',      themeCodes: ['011', '385', '141', '197', '190', '557', '463', '555'] }, // 바이오(73), 제약(94), 바이오시밀러(19), 위탁생산(CMO,CDMO)(10), 신약개발(40), 면역항암제(29), 비만치료제(9), 유전자치료제(24)
  { id: 'medical',   name: '의료기기/미용의료', themeCodes: ['077', '532', '968', '104'] },                      // 의료기기(61), 피부미용기기(9), 보톡스(9), 치과의료(12)
  { id: 'finance',   name: '금융',            themeCodes: ['324', '285', '328'] },                             // 은행(13), 증권(25), 보험(14)
  { id: 'holding',   name: '지주회사',         themeCodes: ['039'] },                                           // 지주(52)
  { id: 'steel',     name: '철강/비철금속',    themeCodes: ['044', '132', '267', '998'] },                      // 철강금속(81), 비철금속(23), 강관업체(13), 구리(7)
  { id: 'chem',      name: '석유화학/정유',    themeCodes: ['340', '131'] },                                    // 석유화학(80), 정유(3)
  { id: 'construct', name: '건설/건자재',      themeCodes: ['322', '037', '146'] },                             // 건설사(49), 건자재(48), 시멘트(9)
  { id: 'cosmetic',  name: '화장품',          themeCodes: ['908'] },                                           // 화장품(47)
  { id: 'food',      name: '음식료',          themeCodes: ['919', '961', '268'] },                             // 음식료(56), 가정간편식(11), 건강기능식품(21)
  { id: 'enter',     name: '엔터/미디어/콘텐츠', themeCodes: ['015', '893', '098', '138', '786'] },              // 엔터테인먼트(15), 콘텐츠(20), 영화/드라마제작(11), 미디어(21), 웹툰(8)
  { id: 'game',      name: '게임',            themeCodes: ['014'] },                                           // 게임(42)
  { id: 'internet',  name: '인터넷/플랫폼',    themeCodes: ['001', '029'] },                                    // 인터넷서비스(13), 전자상거래(9)
  { id: 'telecom',   name: '통신/네트워크',    themeCodes: ['386', '382', '901', '210', '045'] },               // 통신사(3), 통신장비(47), 5G(19), 네트워크장비(22), 광통신(16)
  { id: 'display',   name: '디스플레이',       themeCodes: ['195', '122', '043', '118'] },                      // OLED(40), AMOLED(19), 플렉서블 디스플레이(14), 마이크로LED(8)
  { id: 'itparts',   name: '스마트폰/IT부품',  themeCodes: ['906', '679', '678', '387', '240', '628', '383'] }, // 스마트폰(85), 갤럭시부품(35), 아이폰(22), 카메라모듈/부품(28), PCB(15), MLCC(6), FPCB(7)
  { id: 'logistics', name: '해운/항공/물류',   themeCodes: ['061', '911', '361'] },                             // 해운(7), 항공(10), 종합물류업체(15)
  { id: 'retail',    name: '유통/여행/레저',   themeCodes: ['021', '106', '057', '999', '042'] },               // 백화점/홈쇼핑/편의점(19), 면세점 관련주(5), 여행(7), 호텔(11), 카지노(8)
  { id: 'textile',   name: '섬유/의류',        themeCodes: ['931'] },                                           // 섬유/의류(74)
  { id: 'crypto',    name: '가상자산/핀테크',  themeCodes: ['033', '831', '997'] },                             // 가상화폐(20), 블록체인(15), 핀테크(33)
];

export const SECTOR_GROUP_BY_ID: ReadonlyMap<string, SectorGroup> = new Map(SECTOR_GROUPS.map((g) => [g.id, g]));

// 시총 상위 왜곡 주범 위주 수동 오버라이드 — 종목코드 → 대표 섹터 id. 규칙(테마수 최소)만으로는
// 삼성전자가 HBM/CXL(테마 수 적은 반도체)로 가긴 하지만, 삼성전기(전장·MLCC·갤럭시부품 등)나
// LG화학(석유화학 vs 2차전지)처럼 규칙이 엉뚱한 곳을 고를 수 있는 종목은 여기서 못 박는다.
// 값이 SECTOR_GROUPS에 없는 id면 무시(규칙 적용) — 그룹을 지울 때 여기까지 같이 고치지 않아도 안전.
export const MEGA_CAP_SECTOR_OVERRIDE: Readonly<Record<string, string>> = {
  '005930': 'semicon',   // 삼성전자
  '000660': 'semicon',   // SK하이닉스
  '042700': 'semicon',   // 한미반도체
  '009150': 'itparts',   // 삼성전기
  '066570': 'itparts',   // LG전자
  '373220': 'battery',   // LG에너지솔루션
  '006400': 'battery',   // 삼성SDI
  '051910': 'battery',   // LG화학 — 시장은 2차전지 소재주로 취급(석유화학이 본업이나 수급은 배터리 이슈 추종). 판단 바뀌면 'chem'
  '005380': 'auto',      // 현대차
  '000270': 'auto',      // 기아
  '012330': 'auto',      // 현대모비스
  '207940': 'bio',       // 삼성바이오로직스
  '068270': 'bio',       // 셀트리온
  '035420': 'internet',  // NAVER
  '035720': 'internet',  // 카카오
  '105560': 'finance',   // KB금융
  '055550': 'finance',   // 신한지주
  '012450': 'defense',   // 한화에어로스페이스
  '042660': 'ship',      // 한화오션
  '329180': 'ship',      // HD현대중공업
  '009540': 'ship',      // HD한국조선해양
  '010140': 'ship',      // 삼성중공업
  '034020': 'nuclear',   // 두산에너빌리티
  '005490': 'steel',     // POSCO홀딩스
  '028260': 'holding',   // 삼성물산
};

// 종목의 대표 섹터 1개. candidates = 테마 마스터로 구한 소속 그룹 id 목록(lib/theme-master.ts).
// 1) 오버라이드 맵에 있고 그 id가 유효하면 그것(테마 마스터 소속 여부와 무관 — 마스터가 빠뜨려도 귀속).
// 2) 아니면 candidates 중 themeCodes 수가 가장 적은 그룹, 동률이면 groups 배열 순서.
export function resolvePrimarySector(
  ticker: string,
  candidates: string[],
  groups: SectorGroup[] = SECTOR_GROUPS,
  override: Readonly<Record<string, string>> = MEGA_CAP_SECTOR_OVERRIDE,
): string | null {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const forced = override[ticker];
  if (forced && byId.has(forced)) return forced;
  let best: SectorGroup | null = null;
  for (const id of candidates) {
    const g = byId.get(id);
    if (!g) continue;
    if (!best || g.themeCodes.length < best.themeCodes.length) best = g;
  }
  return best?.id ?? null;
}
