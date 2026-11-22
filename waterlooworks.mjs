export const origin = 'https://waterlooworks.uwaterloo.ca';
const boards = new Map([
  ['direct', '/myAccount/co-op/direct/jobs.htm'],
  ['full', '/myAccount/co-op/full/jobs.htm'],
]);

export async function readBoard(context, profile, board = 'direct') {
  const path = boards.get(board);
  if (!path) {
    throw new Error('Enter a supported WaterlooWorks job board.');
  }
  const boardUrl = origin + path;
  const tabs = context.pages().filter(tab => tab.url().startsWith(origin + '/myAccount/'));
  const signedInTab = tabs.find(tab => new URL(tab.url()).pathname === path) ?? tabs[0];
  const page = signedInTab ?? await context.newPage();
  try {
    if (new URL(page.url()).pathname !== path) {
      await page.goto(boardUrl, { waitUntil: 'commit', timeout: 12000 }).catch(() => {
        throw new Error('Could not load the selected WaterlooWorks board in Steel. Check the live browser and try again.');
      });
    }
    if (new URL(page.url()).pathname !== path || new URL(page.url()).origin !== origin) {
      throw new Error('Open the Steel browser and complete WaterlooWorks sign-in and 2FA, then try again.');
    }
    const table = page.locator('table').filter({
      has: page.locator('thead th, thead td, [role="columnheader"]').filter({ hasText: /Job\s+Title/i }),
    }).or(page.locator('table').filter({ has: page.locator('tbody a.overflow--ellipsis') }));
    const visibleTable = table.filter({ visible: true }).first();
    const programLabel = /^\s*My Program(?:\s*[:–-]?\s*(?:toggle[_ ](?:on|off)|on|off))?\s*$/i;
    const myProgram = page.locator('button, [role="switch"], [role="checkbox"], label')
      .filter({ hasText: programLabel })
      .or(page.getByRole('switch', { name: programLabel }))
      .or(page.getByRole('checkbox', { name: programLabel }))
      .or(page.locator('[aria-label="My Program" i], [title="My Program" i]'))
      .filter({ visible: true }).first();
    const programFilter = page.locator('[aria-label^="Clear Filter: My Program: Yes" i]')
      .or(page.getByText(/^My Program:\s*Yes(?:\s+close)?$/i))
      .filter({ visible: true }).first();
    const programEnabled = async () => {
      if (await programFilter.isVisible()) {
        return true;
      }
      return myProgram.evaluate(control => {
        const input = control.control ?? control.querySelector('input[type="checkbox"]') ?? control;
        return input.checked === true ||
          control.matches('[aria-checked="true"], [aria-pressed="true"], [data-state="checked"], [data-state="on"]') ||
          Boolean(control.querySelector('[aria-checked="true"], [aria-pressed="true"], [data-state="checked"], [data-state="on"]')) ||
          /\btoggle_on\b/i.test(control.textContent);
      }, undefined, { timeout: 1000 }).catch(() => undefined);
    };
    async function openFilteredBoard() {
      await myProgram.or(programFilter).first().waitFor({ timeout: 15000 }).catch(() => {
        throw new Error('Could not find the My Program toggle on the selected WaterlooWorks board.');
      });
      let enabled = await programEnabled();
      for (let attempt = 0; enabled === undefined && attempt < 4; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        enabled = await programEnabled();
      }
      if (enabled === undefined) {
        throw new Error('Could not read the My Program toggle state after retrying. Check the live WaterlooWorks tab.');
      }
      if (!enabled) {
        await myProgram.click({ timeout: 8000 }).catch(() => {
          throw new Error('Could not click the My Program toggle on the selected WaterlooWorks board.');
        });
        const deadline = Date.now() + 10000;
        while (!await programEnabled()) {
          if (Date.now() >= deadline) {
            throw new Error('Could not confirm that My Program was enabled on the selected WaterlooWorks board.');
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      await visibleTable.waitFor({ timeout: 20000 }).catch(() => {
        throw new Error('Could not find the posting list after enabling My Program. Check the live browser for a filter prompt or access message.');
      });
    }
    await openFilteredBoard();
    return { board, ready: true };
  } catch (error) {
    if (!signedInTab) {
      await page.close().catch(() => {});
    }
    throw error;
  }
}
