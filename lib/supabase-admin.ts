import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// 모듈 로드 시 즉시 실행하면 Next.js 빌드 page-data collection 단계에서
// NEXT_PUBLIC_SUPABASE_URL이 없을 때 에러가 발생한다. Proxy로 첫 접근 시점까지 지연.
let _client: ReturnType<typeof createClient<Database>> | null = null;

// 별도 개발용 Supabase 프로젝트가 없어 로컬(next dev)도 프로덕션과 같은 DB를 가리킨다.
// 자동화 테스트 스크립트가 실제 유저 데이터를 승인/변경하는 사고가 있었던 뒤로,
// 로컬에서는 service-role 키가 없으면(=.env.local에서 의도적으로 비워둔 상태) 즉시 에러를
// 던져 프로덕션 쓰기 작업을 기본 차단한다. 정말 필요할 때만 ALLOW_PROD_ADMIN_CLIENT_IN_DEV=true +
// SUPABASE_SERVICE_ROLE_KEY_DANGEROUS_PROD 값을 SUPABASE_SERVICE_ROLE_KEY로 복사해 의식적으로 우회한다.
function resolveServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isProd = process.env.NODE_ENV === 'production';
  const overrideAllowed = process.env.ALLOW_PROD_ADMIN_CLIENT_IN_DEV === 'true';
  if (key && (isProd || overrideAllowed)) return key;
  if (!isProd) {
    throw new Error(
      '[adminClient] 로컬 개발 환경에서 프로덕션 Supabase에 service-role로 접근하려 했습니다. ' +
      '이 프로젝트는 별도 개발 DB가 없어 .env.local의 SUPABASE_SERVICE_ROLE_KEY를 기본적으로 비워둡니다. ' +
      '정말 필요하면 ALLOW_PROD_ADMIN_CLIENT_IN_DEV=true 를 설정하고 ' +
      'SUPABASE_SERVICE_ROLE_KEY_DANGEROUS_PROD 값을 SUPABASE_SERVICE_ROLE_KEY에 복사하세요.'
    );
  }
  throw new Error('[adminClient] SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.');
}

export const adminClient = new Proxy(
  {} as ReturnType<typeof createClient<Database>>,
  {
    get(_, prop, receiver) {
      if (!_client) {
        _client = createClient<Database>(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          resolveServiceRoleKey(),
        );
      }
      return Reflect.get(_client, prop, receiver);
    },
  },
);
