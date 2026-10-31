// Контекст запиту на AsyncLocalStorage: requestId, userId, tenantId.
// Його читають репозиторії (tenant_id) і audit-підписник (хто і в якому запиті змінив дані).
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export type RequestStore = {
  requestId: string;
  userId: string | null;
  tenantId: string | null;
  role: string | null;
};

const storage = new AsyncLocalStorage<RequestStore>();

@Injectable()
export class RequestContext {
  run<T>(store: RequestStore, fn: () => T): T {
    return storage.run(store, fn);
  }

  current(): RequestStore | undefined {
    return storage.getStore();
  }

  setUser(userId: string, tenantId: string, role: string): void {
    const store = storage.getStore();
    if (!store) return;
    store.userId = userId;
    store.tenantId = tenantId;
    store.role = role;
  }

  /** Роль поточного користувача (з JWT). Null у worker-і: там немає користувача. */
  role(): string | null {
    return storage.getStore()?.role ?? null;
  }

  requestId(): string | null {
    return storage.getStore()?.requestId ?? null;
  }

  userId(): string | null {
    return storage.getStore()?.userId ?? null;
  }

  /** Повертає tenant поточного запиту або кидає помилку: без tenant працювати з даними не можна. */
  tenantIdOrFail(): string {
    const tenantId = storage.getStore()?.tenantId;
    if (!tenantId) throw new Error('TenantContext: запит без tenantId (немає JWT або контекст не встановлено)');
    return tenantId;
  }
}

/** Для worker-процесу: виконати функцію "від імені" tenant без HTTP-запиту. */
export function runWithTenant<T>(ctx: RequestContext, tenantId: string, userId: string | null, fn: () => T): T {
  return ctx.run({ requestId: `worker-${Date.now()}`, userId, tenantId, role: null }, fn);
}
