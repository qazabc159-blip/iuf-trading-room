// Loaded via --import before any test module. Sets NODE_ENV=test so that
// startSchedulers() in server.ts detects CI/test mode and skips all scheduler boot.
// This prevents boot catch-up setTimeout/setInterval from keeping the Node event loop
// alive after tests complete, eliminating CI hang.
process.env.NODE_ENV = "test";

// Tests exercise KGI client behavior with mocked fetch at any wall-clock time —
// disable the EventBridge uptime short-circuit (kgi-gateway-schedule.ts) so the
// mocks are reached. Production keeps the guard.
process.env.KGI_GATEWAY_ALWAYS_ON = "true";
