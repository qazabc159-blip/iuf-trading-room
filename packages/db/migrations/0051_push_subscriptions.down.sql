-- Down migration 0051: remove authenticated Web Push subscriptions.

DROP TABLE IF EXISTS push_subscriptions;
