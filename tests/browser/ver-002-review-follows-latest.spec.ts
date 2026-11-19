import {expect, test, type Page} from "@playwright/test";

import {publishNew, publishVersion} from "../support/publishing.js";
import {
  localLogin,
  startBrowserFixture,
  stopBrowserFixture,
} from "./browser-fixture.js";

function page(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>${title}</title></head>
  <body><h1>${title}</h1></body>
</html>`;
}

/** The heading inside the sandboxed artifact frame of one review page. */
function heading(review: Page, title: string) {
  return review
    .frameLocator(".as-artifact-frame")
    .frameLocator("iframe")
    .getByRole("heading", {name: title});
}

test.describe("VER-002 the review address without a version follows the current version", () => {
  test("VER-002-B VER-002-F: a version-less address moves to a new version without a reload, while an exact-version address and a picked version stay put", async ({browser}) => {
    test.setTimeout(120_000);
    const fixture = await startBrowserFixture(browser);
    try {
      const first = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required",
        content: page("First draft"),
        idempotencyKey: "ver-002-follow-first-version",
        mediaType: "text/html; charset=utf-8",
        path: "index.html",
        name: "Following report",
      });
      expect(first.response.status).toBe(201);
      const artifactId = first.body.artifact.id;
      const firstVersionId = first.body.version.id;

      await localLogin(fixture);
      const base = `${fixture.server.baseUrl}/review?project=prj_default&artifact=${artifactId}`;
      const frame = (title: string) => heading(fixture.page, title);

      // An exact-version tab, opened before the new version exists.
      const pinned = await fixture.context.newPage();
      await pinned.goto(`${base}&version=${firstVersionId}&view=focus`);
      await expect(heading(pinned, "First draft")).toBeVisible();

      // The version-less address follows.
      await fixture.page.goto(`${base}&view=focus`);
      await expect(frame("First draft")).toBeVisible();

      const second = await publishVersion(fixture.server, fixture.installation, {
        artifactId,
        content: page("Second draft"),
        expectedCurrentVersionId: firstVersionId,
        idempotencyKey: "ver-002-follow-second-version",
        mediaType: "text/html; charset=utf-8",
        path: "index.html",
      });
      expect(second.response.status).toBe(201);

      // Behavior: the followed page switches by itself, on the page's own poll,
      // and its address still names no version.
      await expect(frame("Second draft")).toBeVisible({timeout: 30_000});
      expect(new URL(fixture.page.url()).searchParams.has("version")).toBe(false);

      // Failure: the exact-version page never moved, and still names its version.
      await pinned.waitForTimeout(8_000);
      await expect(heading(pinned, "First draft")).toBeVisible();
      expect(new URL(pinned.url()).searchParams.get("version")).toBe(firstVersionId);

      // Failure: a reviewer who picks an earlier version while following is pinned.
      await fixture.page.getByRole("button", {name: "Exit full screen"}).click();
      await fixture.page.getByRole("tab", {name: "Versions"}).click();
      await fixture.page.getByRole("button", {name: /^Version 1/u}).click();
      await expect(frame("First draft")).toBeVisible();
      const third = await publishVersion(fixture.server, fixture.installation, {
        artifactId,
        content: page("Third draft"),
        expectedCurrentVersionId: second.body.version.id,
        idempotencyKey: "ver-002-follow-third-version",
        mediaType: "text/html; charset=utf-8",
        path: "index.html",
      });
      expect(third.response.status).toBe(201);
      await fixture.page.waitForTimeout(8_000);
      await expect(frame("First draft")).toBeVisible();
      expect(new URL(fixture.page.url()).searchParams.get("version")).toBe(firstVersionId);
    } finally {
      await stopBrowserFixture(fixture);
    }
  });
});
