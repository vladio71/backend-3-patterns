// Повний список сутностей: для AppModule, worker і CLI міграцій.
import { Tenant } from './modules/auth/tenant.entity';
import { User } from './modules/auth/user.entity';
import { Product } from './modules/products/product.entity';
import { ProductImage } from './modules/files/product-image.entity';
import { Order } from './modules/orders/order.entity';
import { OrderItem } from './modules/orders/order-item.entity';
import { IdempotencyKey } from './modules/orders/idempotency-key.entity';
import { Payment } from './modules/payments/payment.entity';
import { ProcessedWebhookEvent } from './modules/payments/processed-webhook-event.entity';
import { Shipment } from './modules/checkout/shipment.entity';
import { CheckoutSaga } from './modules/checkout/checkout-saga.entity';
import { OutboxEvent } from './modules/outbox/outbox-event.entity';
import { ConsumedEvent } from './modules/outbox/consumed-event.entity';
import { AuditLog } from './modules/audit/audit-log.entity';
import { FeatureFlag } from './modules/feature-flags/feature-flag.entity';
import { SentEmail } from './modules/notifications/sent-email.entity';

export const ENTITIES = [
  Tenant, User, Product, ProductImage, Order, OrderItem, IdempotencyKey, Payment, ProcessedWebhookEvent,
  Shipment, CheckoutSaga, OutboxEvent, ConsumedEvent, AuditLog, FeatureFlag, SentEmail,
];
