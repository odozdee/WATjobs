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
    const titleLinks = visibleTable.locator('tbody a.overflow--ellipsis');
    const readEntries = async () => {
      await visibleTable.evaluate(async table => {
        let moved = false;
        for (let container = table.parentElement; container && container !== document.body; container = container.parentElement) {
          const overflow = container.scrollWidth - container.clientWidth;
          if (overflow < 2 || !/auto|scroll/.test(getComputedStyle(container).overflowX)) {
            continue;
          }
          container.scrollLeft = getComputedStyle(container).direction === 'rtl' ? -overflow : overflow;
          moved = true;
        }
        if (moved) {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
      }, undefined, { timeout: 3000 });
      return titleLinks.evaluateAll(links => links.map((link, index) => {
        const row = link.closest('tr');
        const table = row.closest('table');
        const headingRows = [...(table.tHead?.rows ?? [])];
        if (!headingRows.length && table.rows[0]) {
          headingRows.push(table.rows[0]);
        }
        const cells = [...row.cells];
        function field(label) {
          const labeled = cells.find(cell => ['data-label', 'data-title', 'aria-label']
            .some(attribute => label.test((cell.getAttribute(attribute) || '').trim())));
          const heading = headingRows.flatMap(row => [...row.cells]).find(cell =>
            label.test((cell.innerText || cell.textContent).trim()) ||
            ['aria-label', 'title'].some(attribute => label.test((cell.getAttribute(attribute) || '').trim())));
          const cell = labeled ?? cells[heading?.cellIndex];
          const value = (cell?.innerText.trim() || cell?.textContent.trim() || '').replace(/\s+/g, ' ');
          return /^(?:not listed|n\/?a|[-–—]+)$/i.test(value) ? '' : value;
        }
        return {
          index,
          title: link.innerText.trim(),
          jobId: field(/^(?:job )?id\b/i) || cells[1]?.innerText.trim(),
          company: field(/^organization\b/i) || cells[3]?.innerText.trim(),
          location: field(/^(?:job\s*[-–—]?\s*)?(?:city|location)\b/i),
          level: field(/^(?:job )?level\b/i),
          applicationDeadline: field(/^(?:app(?:lication)?[.\s]*)?deadline\b/i),
          duration: field(/^(?:work term (?:duration|length)|job duration|duration)\b/i),
          term: cells[0]?.innerText.match(/\d{4}\s*-\s*(Winter|Spring|Fall)/i)?.[0],
        };
      }));
    };
    return { board, ready: true, jobs: await readEntries() };
  } catch (error) {
    if (!signedInTab) {
      await page.close().catch(() => {});
    }
    throw error;
  }
}
