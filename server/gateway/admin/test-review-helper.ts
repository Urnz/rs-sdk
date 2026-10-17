import { expect } from 'bun:test';
import type { Page } from 'puppeteer';

/** Existing workflow tests must explicitly cross the new user-facing review step. */
export async function approveOperation(page: Page) {
    await page.waitForSelector('#operation-review[open]');
    expect(await page.$$eval('#operation-review section', sections => sections.filter(section => section.querySelector('p')?.textContent?.trim()).length)).toBeGreaterThanOrEqual(5);
    await page.click('[data-review-approve]');
    await page.waitForSelector('#operation-review', { hidden: true });
}
