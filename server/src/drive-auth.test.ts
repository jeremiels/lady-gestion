import assert from "node:assert/strict";
import { test } from "node:test";
import { grantsDrive } from "./drive-auth.ts";

test("counts a sign-in as Drive only when the Drive box was ticked", () => {
  assert.equal(
    grantsDrive(
      "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive",
    ),
    true,
  );
  // The consent screen's boxes left unticked: a sign-in that reads no file.
  assert.equal(
    grantsDrive("openid https://www.googleapis.com/auth/userinfo.email"),
    false,
  );
  // A narrower Drive scope is not the one the app needs.
  assert.equal(
    grantsDrive("https://www.googleapis.com/auth/drive.file"),
    false,
  );
  assert.equal(grantsDrive(undefined), false);
});
