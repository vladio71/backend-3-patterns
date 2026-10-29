#!/usr/bin/env bash
# Прохід по всіх 12 модулях через curl. Потрібні запущені API (BASE_URL, типово http://localhost:3002) і worker.
#   docker compose up --build   (або npm run dev + npm run dev:worker)
#   npm run seed
#   ./scripts/smoke.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3002}"
WEBHOOK_SECRET="${PAYMENT_WEBHOOK_SECRET:-whsec-dev}"
RUN_ID="$(date +%s)-$RANDOM"
TENANT="smoke-$RUN_ID"

step() { printf '\n== %s\n' "$1"; }
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v=JSON.parse(s);for(const k of process.argv[1].split("."))v=v?.[k];console.log(v===undefined?"":typeof v==="object"?JSON.stringify(v):v)})' "$1"; }
api() { local method="$1" path="$2"; shift 2; curl -sS -X "$method" "$BASE_URL$path" -H "Content-Type: application/json" -H "Authorization: Bearer ${TOKEN:-}" "$@"; }
assert_eq() { if [ "$1" != "$2" ]; then echo "FAIL: $3 (очікували '$2', отримали '$1')"; exit 1; fi; echo "ok: $3"; }

step "health"
curl -sS "$BASE_URL/health"; echo

step "auth: новий tenant, перший користувач admin"
TOKEN="$(curl -sS -X POST "$BASE_URL/auth/register" -H "Content-Type: application/json" -d "{\"tenantSlug\":\"$TENANT\",\"email\":\"admin@$TENANT.test\",\"password\":\"password123\"}" | field accessToken)"
ME="$(api GET /auth/me)"; echo "$ME"
assert_eq "$(echo "$ME" | field role)" "admin" "роль admin"

step "multi-tenant + optimistic-lock: товар, PATCH зі старою version"
PRODUCT="$(api POST /products -d '{"sku":"SMOKE-1","name":"Клавіатура","priceCents":1990,"stock":10}')"
PRODUCT_ID="$(echo "$PRODUCT" | field id)"
api PATCH "/products/$PRODUCT_ID" -d '{"version":1,"name":"Клавіатура v2"}' >/dev/null
STALE="$(api PATCH "/products/$PRODUCT_ID" -d '{"version":1,"name":"Клавіатура v3"}')"
assert_eq "$(echo "$STALE" | field code)" "STALE_VERSION" "409 STALE_VERSION"

step "feature flags + versioning: /v1 і /v2"
assert_eq "$(api GET /v1/products | field 0.price)" "1990" "/v1 price число"
assert_eq "$(api GET /v2/products | field 0.price.amount)" "1990" "/v2 price.amount"
api PUT /admin/flags/products-v2-default -d "{\"enabled\":true,\"percentage\":0,\"allowlist\":[\"$(echo "$ME" | field id)\"]}" >/dev/null
assert_eq "$(api GET /products | field 0.price.amount)" "1990" "/products через прапорець віддає v2"

step "idempotency: Idempotency-Key на POST /orders"
KEY="key-$RUN_ID"
ORDER="$(api POST /orders -H "Idempotency-Key: $KEY" -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"qty\":2}]}")"
ORDER_ID="$(echo "$ORDER" | field id)"
REPLAY_HEADER="$(curl -sS -D - -o /dev/null -X POST "$BASE_URL/orders" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $KEY" -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"qty\":2}]}" | grep -i idempotent-replayed | tr -d '\r')"
assert_eq "$REPLAY_HEADER" "Idempotent-Replayed: true" "повтор віддає Idempotent-Replayed"

step "idempotency: вебхук з HMAC двічі"
BODY="{\"eventId\":\"evt-$RUN_ID\",\"type\":\"payment.succeeded\",\"orderId\":\"$ORDER_ID\",\"amountCents\":3980}"
SIG="$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')"
assert_eq "$(curl -sS -X POST "$BASE_URL/payments/webhook" -H "Content-Type: application/json" -H "X-Signature: $SIG" -d "$BODY" | field duplicate)" "false" "перша доставка застосована"
assert_eq "$(curl -sS -X POST "$BASE_URL/payments/webhook" -H "Content-Type: application/json" -H "X-Signature: $SIG" -d "$BODY" | field duplicate)" "true" "друга доставка duplicate"
assert_eq "$(api GET "/orders/$ORDER_ID" | field status)" "paid" "замовлення paid"

step "saga: checkout з відмовою платежу"
FAILED="$(api POST /checkout -H "X-Fail-Payment: 1" -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"qty\":1}],\"address\":\"Миколаїв\"}")"
assert_eq "$(echo "$FAILED" | field code)" "CHECKOUT_FAILED" "checkout впав на платежі"
assert_eq "$(api GET "/checkout/sagas/$(echo "$FAILED" | field sagaId)" | field status)" "compensated" "саґа compensated"
assert_eq "$(api GET "/products/$PRODUCT_ID" | field stock)" "10" "stock повернуто"

step "saga + outbox + notifications: успішний checkout, лист від worker-а"
OK="$(api POST /checkout -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"qty\":1}],\"address\":\"Миколаїв\"}")"
assert_eq "$(echo "$OK" | field status)" "completed" "саґа completed"
for _ in $(seq 1 30); do
  COUNT="$(api GET "/notifications/emails?to=admin@$TENANT.test" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))')"
  [ "$COUNT" -ge 2 ] && break
  sleep 1
done
# Два листи: один за order.paid від вебхука вище, другий за order.paid із цього checkout.
assert_eq "$COUNT" "2" "worker надіслав 2 листи (outbox -> events -> notifications)"

step "circuit-breaker: 5 падінь провайдера відкривають breaker"
api POST /demo/payment-provider -d '{"failing":true,"latencyMs":0}' >/dev/null
for _ in 1 2 3 4 5; do api POST /checkout -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"qty\":1}],\"address\":\"x\"}" >/dev/null; done
assert_eq "$(api GET /demo/payment-provider/state | field breaker.state)" "open" "breaker open"
api POST /demo/payment-provider -d '{"failing":false,"latencyMs":0}' >/dev/null

step "audit + soft delete"
api DELETE "/products/$PRODUCT_ID" >/dev/null
assert_eq "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/products/$PRODUCT_ID" -H "Authorization: Bearer $TOKEN")" "404" "видалений товар 404"
api POST "/products/$PRODUCT_ID/restore" >/dev/null
api GET "/audit?entity=product&entityId=$PRODUCT_ID" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("audit:",JSON.parse(s).map(r=>r.action).join(" -> ")))'

step "files: presign (сховище за STORAGE_DRIVER)"
api POST "/products/$PRODUCT_ID/images/presign" -d '{"contentType":"image/png","size":1024}' | field upload.url

step "profiling"
api GET /demo/fast-report | field timingMs

echo; echo "SMOKE OK ($TENANT)"
