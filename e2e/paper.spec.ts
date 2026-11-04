import { test, expect } from "@playwright/test";
import { encodeShape, type Point } from "../src/paper";
const points: Point[] = Array.from({ length: 19 }, (_, i) => [
  (i % 7) - Math.floor(Math.floor(i / 7) / 2),
  Math.floor(i / 7),
]);
const token = encodeShape(points);
test("create, share a shape without numbers, score and resume paper games", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("./");
  await page
    .getByRole("button", { name: "Score a paper game", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Score board", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Shape name (optional)", exact: true })
    .fill("Sunday = café 🐝");
  for (let i = 0; i < 19; i++)
    await page
      .getByRole("button", {
        name: `Row ${Math.floor(i / 7) + 1}, column ${(i % 7) + 1}`,
        exact: true,
      })
      .click();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.getByRole("button", { name: "Share board", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Board link", exact: true }),
  ).not.toHaveValue(/=/);
  await expect(
    page.getByRole("button", {
      name: "Sunday = café 🐝 · 0/19 entered",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Score board", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Current score", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Bubble 1", exact: true }).fill("0");
  await expect(page.locator(".total")).toHaveText("-3");
  await page.getByRole("textbox", { name: "Bubble 1", exact: true }).fill("");
  await expect(page.locator(".total")).toHaveText("0");
  for (let i = 1; i <= 19; i++)
    await page
      .getByRole("textbox", { name: `Bubble ${i}`, exact: true })
      .fill("5");
  await expect(
    page.getByRole("heading", { name: "Final score", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".total")).toHaveText("98");
  await page.getByRole("button", { name: /Set 1: bubbles/ }).click();
  await expect(page.locator(".paper-number.highlighted")).toHaveCount(19);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.getByRole("button", { name: "Share board", exact: true }).click();
  const link = await page
    .getByRole("textbox", { name: "Board link", exact: true })
    .inputValue();
  expect(link).toContain("#shape/");
  expect(link).not.toContain("=");
  expect(link.length).toBeLessThan(180);
  const context = await browser.newContext();
  const recipient = await context.newPage();
  await recipient.goto(link);
  await expect(
    recipient.getByRole("textbox", { name: "Bubble 1", exact: true }),
  ).toHaveValue("");
  await expect(recipient.locator(".total")).toHaveText("0");
  await expect(
    recipient.getByRole("textbox", {
      name: "Shape name (optional)",
      exact: true,
    }),
  ).toHaveValue("Sunday = café 🐝");
  await context.close();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await page
    .getByRole("button", {
      name: "Sunday = café 🐝 · 19/19 entered",
      exact: true,
    })
    .click();
  await expect(page.locator(".total")).toHaveText("98");
  await page
    .getByRole("button", { name: "Start fresh score", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Bubble 1", exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("button", {
      name: "Sunday = café 🐝 · 19/19 entered",
      exact: true,
    })
    .click();
  await expect(page.locator(".total")).toHaveText("98");
});
test("imported shape resumes offline and invalid links do not overwrite saved numbers", async ({
  page,
  context,
}) => {
  await page.goto(`./#shape/${token}`);
  await page.getByRole("textbox", { name: "Bubble 1", exact: true }).fill("12");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Bubble 1", exact: true }),
  ).toHaveValue("12");
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Bubble 1", exact: true }),
  ).toHaveValue("12");
  await page.getByRole("textbox", { name: "Bubble 2", exact: true }).fill("13");
  await expect(page.locator(".total")).toHaveText("14");
  await page.goto("./#shape/broken");
  await expect(page.getByRole("alert")).toContainText(
    "incomplete or unsupported",
  );
  await page
    .getByRole("button", { name: "Paper board · 2/19 entered", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Bubble 1", exact: true }),
  ).toHaveValue("12");
});

test("paper storage failure stays visible and malformed saves are retained", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("bubble19-paper-v1", "broken original data"),
  );
  await page.goto(`./#shape/${token}`);
  await expect(page.getByRole("alert")).toContainText("retained");
  await page.getByRole("textbox", { name: "Bubble 1", exact: true }).fill("5");
  await expect(page.locator(".total")).toHaveText("-3");
  expect(
    await page.evaluate(() => localStorage.getItem("bubble19-paper-v1")),
  ).toBe("broken original data");
});

test("quota failure permits scoring and Save again retries successfully", async ({
  page,
}) => {
  await page.goto(`./#shape/${token}`);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).restorePaperStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "bubble19-paper-v1")
        throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("textbox", { name: "Bubble 1", exact: true }).fill("5");
  await expect(page.getByRole("alert")).toContainText("Could not save");
  await expect(page.locator(".total")).toHaveText("-3");
  await page.evaluate(() => (window as any).restorePaperStorage());
  await page.getByRole("button", { name: "Save again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Bubble 1", exact: true }),
  ).toHaveValue("5");
});
