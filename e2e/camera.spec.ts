import { expect, test } from "@playwright/test";
import { paperGraph, type Point } from "../src/paper";

const points: Point[] = Array.from({ length: 19 }, (_, i) => [
  (i % 7) - Math.floor(Math.floor(i / 7) / 2),
  Math.floor(i / 7),
]);
const circles = points.map(([q, r], i) => ({
  id: `c${i}`,
  x: 40 + 56 * (q + r / 2),
  y: 40 + 49 * r,
  radius: 22,
  q,
  r,
  value: 5,
  detectionConfidence: 0.9,
  ocrStatus: "read",
}));

test("reviewed camera proposal becomes a normal, editable paper score", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as Window & { __CAMERA_ENDPOINT__?: string }).__CAMERA_ENDPOINT__ =
      "/19-bubble-pwa/api/scan";
  });
  await page.route("**/api/scan", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      json: {
        schema: 1,
        status: "review",
        image: { width: 680, height: 430 },
        circles,
        edges: paperGraph(points).edges,
        warnings: [],
      },
    });
  });
  await page.goto("./#paper");
  await page.getByRole("button", { name: "Scan a paper board" }).click();
  await page.getByLabel("Upload photo").setInputFiles("public/icon-192.png");
  await page.getByRole("button", { name: "Analyze photo online" }).click();
  await expect(
    page.getByRole("heading", { name: "Review the proposed board" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Select detected bubble 1", exact: true })
    .click();
  await page.getByLabel("Number (0–30 or blank)").fill("0");
  await page
    .getByRole("button", { name: "Use this board in manual scorer" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Final score" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Bubble 1", exact: true }),
  ).toHaveValue("0");
  await expect(page.getByRole("textbox", { name: "Bubble 2" })).toHaveValue(
    "5",
  );
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Bubble 1", exact: true }),
  ).toHaveValue("0");
});

test("incomplete camera proposal cannot silently become a paper score", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as Window & { __CAMERA_ENDPOINT__?: string }).__CAMERA_ENDPOINT__ =
      "/19-bubble-pwa/api/scan";
  });
  await page.route("**/api/scan", (route) =>
    route.fulfill({
      json: {
        schema: 1,
        status: "partial",
        image: { width: 680, height: 430 },
        circles: circles.slice(0, 18),
        edges: [],
        warnings: ["Retake or correct"],
      },
    }),
  );
  await page.goto("./#paper");
  await page.getByRole("button", { name: "Scan a paper board" }).click();
  await page.getByLabel("Upload photo").setInputFiles("public/icon-192.png");
  await page.getByRole("button", { name: "Analyze photo online" }).click();
  await expect(page.getByText("18 circles selected.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use this board in manual scorer" }),
  ).toBeDisabled();
});

test("corrected circles can be re-uploaded for one OCR proposal", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as Window & { __CAMERA_ENDPOINT__?: string }).__CAMERA_ENDPOINT__ =
      "/19-bubble-pwa/api/scan";
  });
  let requests = 0;
  await page.route("**/api/scan", async (route) => {
    requests++;
    const geometry = route.request().headers()["x-bubble-geometry"];
    if (requests === 2) {
      expect(JSON.parse(geometry)).toHaveLength(19);
    } else {
      expect(geometry).toBeUndefined();
    }
    await route.fulfill({
      json: {
        schema: 1,
        status: "review",
        image: { width: 680, height: 430 },
        circles: circles.map((circle, i) => ({
          ...circle,
          value: requests === 2 && i === 0 ? 12 : null,
          ocrStatus: requests === 2 && i === 0 ? "read" : "unreadable",
        })),
        edges: paperGraph(points).edges,
        warnings: [],
      },
    });
  });
  await page.goto("./#paper");
  await page.getByRole("button", { name: "Scan a paper board" }).click();
  await page.getByLabel("Upload photo").setInputFiles("public/icon-192.png");
  await page.getByRole("button", { name: "Analyze photo online" }).click();
  await page
    .getByRole("button", { name: "Read numbers from corrected circles online" })
    .click();
  await expect(page.getByLabel("Number (0–30 or blank)")).toHaveValue("12");
  expect(requests).toBe(2);
});
