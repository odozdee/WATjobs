import { filterJobs } from './search.mjs';
export const origin = 'https://waterlooworks.uwaterloo.ca';
const boards = new Map([
  ['direct', '/myAccount/co-op/direct/jobs.htm'],
  ['full', '/myAccount/co-op/full/jobs.htm'],
]);

const nextPageLabel = /^(?:go to\s+)?next(?:\s+page)?(?:\s+(?:chevron_right|navigate_next|keyboard_arrow_right|›|»))?$|^(?:chevron_right|navigate_next|keyboard_arrow_right|›|»|>)$/i;

const previousPageLabel = /^(?:(?:go to\s+)?(?:previous|prev)(?:\s+page)?|chevron_left|navigate_before|keyboard_arrow_left|‹|«|<)$/i;

async function advancePage(page, pageNumber, direction = 1) {
  const label = direction === 1 ? nextPageLabel : previousPageLabel;
  const controls = page.locator('button, a, [role="button"]');
  const arrow = controls.filter({ hasText: label })
    .or(page.getByRole('button', { name: label }))
    .or(page.getByRole('link', { name: label }))
    .or(page.locator(direction === 1
      ? 'a[rel="next"], [title="Next Page" i], [title="Next" i]'
      : 'a[rel="prev"], [title="Previous Page" i], [title="Previous" i]'))
    .filter({ visible: true }).first();
  const numbered = page.locator('[class*="pagin" i], [aria-label*="pagin" i]')
    .locator('button, a, [role="button"]')
    .filter({ hasText: new RegExp('^\\s*' + (pageNumber + direction) + '\\s*$') })
    .filter({ visible: true }).first();
  for (const control of [numbered, arrow]) {
    if (!await control.isVisible() || !await control.isEnabled()) {
      continue;
    }
    if (await control.evaluate(node => Boolean(node.closest('[disabled], [aria-disabled="true"], .disabled, .is--disabled')))) {
      continue;
    }
    await control.click({ timeout: 6000 });
    return true;
  }
  return false;
}

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
    const posting = page.locator('.modal.is--visible').filter({
      has: page.locator('.modal__inner--document-overlay'),
    });
    const banner = page.locator('h2, h3, h4, h5, h6, [role="heading"]')
      .filter({ hasText: /^\s*Job Posting Information\s*:?\s*$/i })
      .filter({ visible: true }).first();
    const close = posting.getByRole('button', { name: /^(?:close(?: (?:document|posting))?|dismiss)$/i })
      .or(posting.locator('button[title*="close" i]')).filter({ visible: true }).first();
    async function closePosting() {
      if (!(await posting.isVisible()) && !(await banner.isVisible())) {
        return;
      }
      try {
        await close.click({ timeout: 4000 });
        await posting.waitFor({ state: 'hidden', timeout: 4000 });
      } catch {
        await page.keyboard.press('Escape');
        await posting.waitFor({ state: 'hidden', timeout: 2500 });
      }
      await banner.waitFor({ state: 'hidden', timeout: 2500 });
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
    const jobs = new Map();
    const seenPages = new Set();
    let pageNumber = 1;
    let entries = await readEntries();
    let interrupted;
    const jobKey = entry => entry.jobId || JSON.stringify([entry.title, entry.company, entry.location]);
    const pageKey = rows => JSON.stringify(rows.map(jobKey).sort());
    while (entries.length) {
      const current = pageKey(entries);
      if (seenPages.has(current)) {
        interrupted = 'WaterlooWorks repeated a results page.';
        break;
      }
      seenPages.add(current);
      for (const entry of entries) {
        const key = jobKey(entry);
        jobs.set(key, { ...entry, description: '', tableOnly: true });
        try {
          await closePosting();
          const currentEntry = (await readEntries()).find(row => jobKey(row) === key);
          if (!currentEntry) {
            continue;
          }
          await titleLinks.nth(currentEntry.index).click({ timeout: 4000 });
          await banner.waitFor({ timeout: 8000 });
          const detail = await banner.evaluate((heading, expected) => {
            const article = heading.closest('.modal__inner--document-overlay') ??
              heading.closest('.is--long-form-reading') ??
              heading.closest('[role="dialog"], .modal, .doc-viewer__document-content');
            const text = article?.innerText.trim() || '';
            const rows = [...(article?.querySelectorAll('tr, dt') || [])];
            function field(label) {
              const row = rows.find(node => label.test((node.cells?.[0]?.innerText ?? node.innerText).trim()));
              const value = row?.cells?.[1] ?? row?.nextElementSibling;
              return value?.innerText.trim();
            }
            const popupId = field(/^(?:Job|Posting)\s+ID\s*:?$/i);
            const popupTitle = field(/^Job Title\s*:?$/i);
            if (popupId && popupId !== expected.jobId) {
              return null;
            }
            if (!popupId && popupTitle && popupTitle.toLowerCase() !== expected.title.toLowerCase()) {
              return null;
            }
            return text ? { description: text } : null;
          }, { jobId: entry.jobId, title: entry.title }, { timeout: 5000 });
          if (detail) {
            jobs.set(key, { ...entry, ...detail, tableOnly: false });
          }
        } catch {
          // Keep the original listing if the popup cannot be read.
        }
        try {
          await closePosting();
        } catch {
          interrupted = 'Could not close a posting popup.';
          break;
        }
      }
      if (interrupted) {
        break;
      }
      try {
        if (!await advancePage(page, pageNumber)) {
          break;
        }
        const deadline = Date.now() + 12000;
        do {
          entries = await readEntries();
          if (entries.length && pageKey(entries) !== current) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        } while (Date.now() < deadline);
        if (!entries.length || pageKey(entries) === current) {
          interrupted = 'WaterlooWorks did not load the next results page.';
          break;
        }
        pageNumber++;
      } catch {
        interrupted = 'Could not finish scanning the results pages.';
        break;
      }
    }
    return { board, ready: true, jobs: filterJobs([...jobs.values()], profile), pagesChecked: seenPages.size, interrupted };
  } catch (error) {
    if (!signedInTab) {
      await page.close().catch(() => {});
    }
    throw error;
  }
}
