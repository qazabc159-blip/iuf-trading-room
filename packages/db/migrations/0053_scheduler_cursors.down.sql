-- Down migration 0053: remove durable scheduler cursors.

DROP TABLE IF EXISTS scheduler_cursors;
