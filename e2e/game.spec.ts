import { test, expect } from "@playwright/test";
async function start(page: any) {
  await page.goto("./");
  await page.getByRole("button", { name: "Start Game", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Roll dice", exact: true }),
  ).toBeVisible();
}
async function submit(page: any) {
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  await page.locator(".operations button:enabled").first().click();
  await page.locator(".bubble.legal").first().click();
  await page.getByRole("button", { name: "Submit Move", exact: true }).click();
  await expect(
    page.getByText("Saved on this device", { exact: true }),
  ).toBeVisible();
}
test("full game, refresh after roll, replay, responsive layout", async ({
  page,
  context,
}) => {
  await start(page);
  const code = await page.locator(".code").innerText();
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  const dice = await page.locator(".dice").getAttribute("aria-label");
  await page.reload();
  await page.getByRole("button", { name: /Continue Game/ }).click();
  await expect(page.locator(".dice")).toHaveAttribute("aria-label", dice!);
  await page.locator(".operations button:enabled").first().click();
  await page.locator(".bubble.legal").first().click();
  await page.getByRole("button", { name: "Submit Move", exact: true }).click();
  for (let i = 1; i < 19; i++) await submit(page);
  await expect(
    page.getByText("19 of 19 placed", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".total")).not.toBeEmpty();
  await expect(
    page.getByRole("button", { name: "Roll dice", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Disable the native share sheet for deterministic copy fallback.
  await page.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.getByRole("button", { name: "Share Result", exact: true }).click();
  const text = await page.locator("#share").inputValue();
  expect(text).toContain(code);
  const link = text.split("Replay: ")[1];
  const other = await context.newPage();
  await other.goto(link);
  await expect(
    other.getByText("READ-ONLY REPLAY", { exact: true }),
  ).toBeVisible();
  await expect(other.locator(".total")).toHaveText(
    await page.locator(".total").innerText(),
  );
  await expect(
    other.getByRole("button", { name: "Roll dice", exact: true }),
  ).toHaveCount(0);
});
test("cached cold page works offline at Pages subpath", async ({
  page,
  context,
}) => {
  await start(page);
  await expect(
    page.getByText("Ready for offline play", { exact: true }),
  ).toBeVisible();
  await submit(page);
  await page.close();
  await context.setOffline(true);
  const offline = await context.newPage();
  await offline.goto("./");
  await offline.getByRole("button", { name: /Continue Game/ }).click();
  await expect(
    offline.getByText("1 of 19 placed · Turn 2", { exact: true }),
  ).toBeVisible();
  await submit(offline);
  await expect(
    offline.getByText("2 of 19 placed · Turn 3", { exact: true }),
  ).toBeVisible();
});
test("two tabs reject stale writes without destroying saved history", async ({
  page,
  context,
}) => {
  await start(page);
  const second = await context.newPage();
  await second.goto("./");
  await second.getByRole("button", { name: /Continue Game/ }).click();
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  await second.getByRole("button", { name: "Roll dice", exact: true }).click();
  await expect(second.getByRole("alert")).toContainText("another tab");
  await expect(
    second.getByText("Progress is not saved", { exact: true }),
  ).toBeVisible();
});
test("narrow phone and keyboard selection", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await start(page);
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  const bubble = page.locator(".bubble.legal").first();
  await bubble.focus();
  await page.keyboard.press("Enter");
  await expect(bubble).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("quota failure remains playable and offers retry/export", async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await start(page);
  await expect(
    page.getByText("Progress is not saved", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  await expect(page.locator(".operations")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export game", exact: true }),
  ).toBeVisible();
});
test("malformed result cannot overwrite existing attempt", async ({ page }) => {
  await start(page);
  await submit(page);
  await page.goto("./#result=eyJzY2hlbWEiOjJ9");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "19 BUBBLES" }).click();
  await page.getByRole("button", { name: /Continue Game/ }).click();
  await expect(
    page.getByText("1 of 19 placed · Turn 2", { exact: true }),
  ).toBeVisible();
});
test("update waits while dice are revealed and preserves progress", async ({
  page,
  request,
}) => {
  await start(page);
  await expect(
    page.getByText("Ready for offline play", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  const dice = await page.locator(".dice").getAttribute("aria-label");
  await request.post("http://127.0.0.1:4173/__test/update");
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
  });
  await expect(
    page.getByText("An update is ready. Save your progress before reloading."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply update at this safe point" }),
  ).toBeDisabled();
  await expect(page.locator(".dice")).toHaveAttribute("aria-label", dice!);
  await page.locator(".operations button:enabled").first().click();
  await page.locator(".bubble.legal").first().click();
  await page.getByRole("button", { name: "Submit Move", exact: true }).click();
  await expect(
    page.getByText("Saved on this device", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Apply update at this safe point" })
    .click();
  await page.getByRole("button", { name: /Continue Game/ }).click();
  await expect(
    page.getByText("1 of 19 placed · Turn 2", { exact: true }),
  ).toBeVisible();
});
test("malformed saves remain recoverable alongside valid games", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("bubble19", 1);
      r.onsuccess = () => {
        const db = r.result,
          t = db.transaction("attempts", "readwrite");
        t.objectStore("attempts").put({
          id: "damaged",
          schema: 999,
          updated: Date.now(),
        });
        t.oncomplete = () => {
          db.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
    });
  });
  await page.reload();
  await expect(
    page.getByText(/unreadable saved record\(s\) retained/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export unreadable record 1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Continue Game/ }).click();
  await expect(
    page.getByRole("button", { name: "Roll dice", exact: true }),
  ).toBeVisible();
});
test("clean profile joins the same challenge with identical subsequent rolls", async ({
  page,
  browser,
}) => {
  await start(page);
  const code = await page.locator(".code").innerText();
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(`http://127.0.0.1:4173/19-bubble-pwa/#challenge=${code}`);
  await other.getByRole("button", { name: "Find challenge" }).click();
  await expect(other.locator(".code")).toHaveText(code);
  for (let turn = 0; turn < 3; turn++) {
    for (const p of [page, other])
      await p.getByRole("button", { name: "Roll dice", exact: true }).click();
    await expect(other.locator(".dice")).toHaveAttribute(
      "aria-label",
      (await page.locator(".dice").getAttribute("aria-label"))!,
    );
    for (const [index, p] of [page, other].entries()) {
      await p.locator(".operations button:enabled").nth(index).click();
      await p.locator(".bubble.legal").first().click();
      await p.getByRole("button", { name: "Submit Move", exact: true }).click();
      await expect(
        p.getByText("Saved on this device", { exact: true }),
      ).toBeVisible();
    }
  }
  await context.close();
});
