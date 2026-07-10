import { describe, expect, it } from "vitest";

import { resolvePushCapability } from "./push-client";

describe("push capability", () => {
  it("requires an installed standalone PWA before exposing the subscription action", () => {
    expect(resolvePushCapability({
      standalone: false,
      serviceWorkerSupported: true,
      pushManagerSupported: true,
      notificationsSupported: true,
    })).toBe("needs-install");
  });

  it("reports unsupported when a standalone browser lacks Web Push primitives", () => {
    expect(resolvePushCapability({
      standalone: true,
      serviceWorkerSupported: true,
      pushManagerSupported: false,
      notificationsSupported: true,
    })).toBe("unsupported");
  });
});
