import { type Page } from '@playwright/test';

/** Open an intentional secondary control through its visible summary. */
async function openDetails(page: Page, selector: string) {
  const details = page.locator(selector).first();
  if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) {
    await details.locator(':scope > summary').click();
  }
}
export const openSourceOptions = (page: Page) => openDetails(page, '.source-alternatives');
export const openRegionSettings = (page: Page) => openDetails(page, '.region-settings');
export const openWorkspaceTools = (page: Page) => openDetails(page, '.workspace-tools');
