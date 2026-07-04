import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// 모듈 로드 시 즉시 실행하면 Next.js 빌드 page-data collection 단계에서
// NEXT_PUBLIC_SUPABASE_URL이 없을 때 에러가 발생한다. Proxy로 첫 접근 시점까지 지연.
let _client: ReturnType<typeof createClient<Database>> | null = null;

export const adminClient = new Proxy(
  {} as ReturnType<typeof createClient<Database>>,
  {
    get(_, prop, receiver) {
      if (!_client) {
        _client = createClient<Database>(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );
      }
      return Reflect.get(_client, prop, receiver);
    },
  },
);
