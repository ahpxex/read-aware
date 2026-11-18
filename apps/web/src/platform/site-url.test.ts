import { expect, test } from "bun:test";
import { wechatGroupInvitationUrl } from "./site-url";

/** The invitation lapses when 25 November 2026 begins in Beijing. */
const LAPSE = Date.parse("2026-11-25T00:00:00+08:00");

test("the WeChat group invitation is offered until it lapses, and not after", () => {
  expect(wechatGroupInvitationUrl(Date.parse("2026-11-18T09:00:00+08:00"))).toStartWith("https://weixin.qq.com/g/");
  expect(wechatGroupInvitationUrl(LAPSE - 1)).toStartWith("https://weixin.qq.com/g/");
  expect(wechatGroupInvitationUrl(LAPSE)).toBeNull();
  expect(wechatGroupInvitationUrl(Date.parse("2027-01-01T00:00:00Z"))).toBeNull();
});
