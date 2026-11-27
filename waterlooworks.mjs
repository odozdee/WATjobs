import { rank } from './search.mjs';

const scanBudgetSeconds = 180;
const scanTimeoutMessage = 'Reached the ' + scanBudgetSeconds + '-second scan limit';

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

export async function readBoard(context, profile, board = 'direct', reportProgress = () => {}, keywordsReady) {
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
    await closePosting().catch(() => {
      throw new Error('Could not close the open posting. Close it in the live browser and try again.');
    });
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
    const scanDeadline = Date.now() + scanBudgetSeconds * 1000;
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
    const jobs = [];
    const candidates = new Map();
    const readMonths = value => [...(value || '').toLowerCase()
      .replace(/\b(four|eight|twelve|sixteen)\b/g, word => ({ four: 4, eight: 8, twelve: 12, sixteen: 16 })[word])
      .matchAll(/\b(4|8|12|16)\b/g)].map(match => match[0] + ' months');
    const seenJobs = new Set();
    const seenPages = new Set();
    const jobKey = entry => entry.jobId || JSON.stringify([entry.title, entry.company, entry.location]);
    const pageKey = entries => JSON.stringify(entries.map(jobKey).sort());
    async function nextEntries(previous, pageNumber, direction = 1) {
      if (!await advancePage(page, pageNumber, direction)) {
        return null;
      }
      const deadline = Math.min(Date.now() + 12000, scanDeadline);
      while (Date.now() < deadline) {
        const next = await readEntries();
        if (next.length && pageKey(next) !== previous) {
          return next;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('WaterlooWorks did not load a new results page');
    }
    async function reopenBoard() {
      await page.goto(boardUrl, { waitUntil: 'commit', timeout: 12000 });
      await openFilteredBoard();
      await titleLinks.first().waitFor({
        timeout: Math.max(1, Math.min(12000, scanDeadline - Date.now())),
      });
      return readEntries();
    }
    let skipped = 0;
    const popupFailures = { open: 0, load: 0, read: 0 };
    let missingDuration = 0;
    let differentDuration = 0;
    let differentLocationOrLevel = 0;
    let missingCityOrLevel = 0;
    let checked = 0;
    let pageNumber = 1;
    const traversal = new Set();
    let interrupted;
    let entries = await readEntries();
    let lastPage = 1;
    while (entries.length && Date.now() < scanDeadline) {
      const current = pageKey(entries);
      if (seenPages.has(current)) {
        break;
      }
      lastPage = pageNumber;
      seenPages.add(current);
      for (const entry of entries) {
        if (entry.term?.replace(/\s*-\s*/, ' - ').toLowerCase() !== profile.term.toLowerCase()) {
          continue;
        }
        const months = readMonths(entry.duration);
        if (months.length && !months.includes(profile.duration)) {
          continue;
        }
        const key = jobKey(entry);
        candidates.set(key, {
          ...entry, key, term: profile.term, duration: months.length ? profile.duration : undefined,
          description: '', tableOnly: true, board,
        });
      }
      reportProgress(candidates.size, seenPages.size, 'list');
      try {
        entries = await nextEntries(current, pageNumber++) ?? [];
      } catch {
        interrupted = 'Could not finish scanning the results pages';
        break;
      }
    }
    await keywordsReady;
    const rankedCandidates = rank([...candidates.values()], profile, true, { includeUnmatched: true });
    const targets = new Map(rankedCandidates.map((job, index) => [job.key, index]));
    const listWarning = interrupted;
    interrupted = undefined;
    pageNumber = lastPage;
    let direction = -1;
    entries = targets.size && Date.now() < scanDeadline ? await readEntries().catch(() => []) : [];
    while (entries.length) {
      const current = pageKey(entries);
      seenPages.add(current);
      traversal.add(current);
      reportProgress(checked, seenPages.size, 'details', targets.size);
      let reopened = false;
      const forTerm = entries.filter(entry =>
        entry.term?.replace(/\s*-\s*/, ' - ').toLowerCase() === profile.term.toLowerCase())
        .filter(entry => targets.has(jobKey(entry)))
        .sort((a, b) => targets.get(jobKey(a)) - targets.get(jobKey(b)));
      for (const entry of forTerm) {
        if (Date.now() >= scanDeadline) {
          interrupted = scanTimeoutMessage;
          break;
        }
        const key = jobKey(entry);
        if (seenJobs.has(key)) {
          continue;
        }
        seenJobs.add(key);
        checked++;
        reportProgress(checked, seenPages.size, 'details', targets.size);
        let stage = 'open';
        try {
          const currentEntry = (await readEntries()).find(row => jobKey(row) === key);
          if (!currentEntry) {
            throw new Error('Posting moved out of the results page');
          }
          await titleLinks.nth(currentEntry.index).click({ timeout: 4000 });
          stage = 'load';
          await banner.waitFor({ timeout: 8000 });
          stage = 'read';
          const detail = await banner.evaluate(async (heading, expected) => {
            const article = heading.closest('.modal__inner--document-overlay') ??
              heading.closest('.is--long-form-reading') ??
              heading.closest('[role="dialog"], .modal, .doc-viewer__document-content');
            const scrollArea = heading.closest('.modal__content .ps') ??
              article?.querySelector('.modal__content .ps, .modal__content');
            const durationLabel = /^(?:Work[\s-]+Term\s+(?:Duration|Length)|(?:Job|Co-op|Placement)\s+(?:Duration|Length)|Duration)\s*:?$/i;
            const durationField = /^[ \t]*(?:Work[ -]+Term[ \t]+(?:Duration|Length)|(?:Job|Co-op|Placement)[ \t]+(?:Duration|Length)|Duration)[ \t]*(?::[ \t]*(?:\r?\n[ \t]*)?|\r?\n[ \t]*|\t+)([^\r\n]+)/im;
            function fieldValue(label) {
              const fields = [...(article?.querySelectorAll('tr, dt, [role="row"]') || [])];
              const field = fields.find(node => label.test((node.cells?.[0]?.innerText ??
                node.querySelector('[role="rowheader"]')?.innerText ?? node.innerText).trim()));
              const value = field?.cells?.[1] ?? field?.querySelector('[role="cell"]') ??
                (field?.tagName === 'DT' ? field.nextElementSibling : undefined);
              if (value) {
                return value.innerText.trim();
              }
              const labels = [...(article?.querySelectorAll('label, strong, b, span') || [])];
              const labelNode = labels.find(node => label.test(node.innerText.trim()));
              return labelNode?.nextElementSibling?.innerText.trim();
            }
            const applicationHeading = () => [...(article?.querySelectorAll('h2, h3, h4, h5, h6') || [])]
              .find(node => /^Application Information\s*:?$/i.test(node.innerText.trim()));
            const initialText = article?.innerText.trim() || '';
            const detailsLoaded = (durationField.test(initialText) || fieldValue(durationLabel)) &&
              /Application Delivery:\s*\S/i.test(initialText) && applicationHeading();
            if (applicationHeading()) {
              applicationHeading().scrollIntoView({ block: 'start' });
              await new Promise(resolve => setTimeout(resolve, 150));
            } else if (scrollArea && !detailsLoaded) {
              scrollArea.scrollTop = 0;
              for (let step = 0; step < 12; step++) {
                const bottom = scrollArea.scrollHeight - scrollArea.clientHeight;
                if (scrollArea.scrollTop >= bottom - 1) {
                  break;
                }
                scrollArea.scrollTop = step === 11
                  ? bottom
                  : Math.min(bottom, scrollArea.scrollTop + scrollArea.clientHeight);
                await new Promise(resolve => setTimeout(resolve, 75));
              }
            }
            let text = article?.innerText.trim() || '';
            let duration = fieldValue(durationLabel) || text.match(durationField)?.[1]?.trim();
            for (let attempt = 0; !duration && attempt < 4; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 200));
              text = article?.innerText.trim() || '';
              duration = fieldValue(durationLabel) || text.match(durationField)?.[1]?.trim();
            }
            const popupId = fieldValue(/^(?:Job|Posting)\s+ID\s*:?$/i) ||
              text.match(/^[ \t]*(?:Job|Posting)\s+ID[ \t]*:[ \t]*(?:\r?\n[ \t]*)?(\d+)\b/im)?.[1];
            const popupTitle = fieldValue(/^Job Title\s*:?$/i);
            const sameTitle = (a, b) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();
            if (popupId && /^\d+$/.test(popupId) && /^\d+$/.test(expected.jobId)) {
              if (popupId !== expected.jobId) {
                return null;
              }
            } else if (popupTitle && !sameTitle(popupTitle, expected.title)) {
              return null;
            }
            const cityLabel = /^(?:Job\s*[-–—]\s*)?(?:Job City|City|Work Location|Job Location)\s*:?$/i;
            const levelLabel = /^(?:(?:Targeted\s+)?(?:Job\s+|Student\s+)?)?Levels?\s*:?$/i;
            const city = fieldValue(cityLabel) ||
              text.match(/^[ \t]*(?:Job\s*[-–—]\s*)?(?:Job City|City|Work Location|Job Location)[ \t]*(?::[ \t]*(?:\r?\n[ \t]*)?|\r?\n[ \t]*|\t+)([^\r\n]+)/im)?.[1]?.trim();
            const levelText = fieldValue(levelLabel) ||
              text.match(/^[ \t]*(?:(?:Targeted\s+)?(?:Job\s+|Student\s+)?)?Levels?[ \t]*:?[ \t]*(?:\r?\n[ \t]*)?((?:Junior|Intermediate|Senior)(?:[\s,;/]+(?:Junior|Intermediate|Senior))*)/im)?.[1];
            const level = levelText?.match(/\b(?:Junior|Intermediate|Senior)\b/gi)?.join(', ');
            const applicationTitle = applicationHeading();
            const application = applicationTitle?.closest('.panel') ?? applicationTitle?.parentElement;
            const deadlineLabel = /^(?:(?:Application|App\.?)\s+)?Deadline\s*:?$/i;
            const applicationDeadline = fieldValue(deadlineLabel) ||
              (application?.innerText || text).match(/^[ \t]*(?:(?:Application|App\.?)\s+)?Deadline[ \t]*(?::[ \t]*(?:\r?\n[ \t]*)?|\r?\n[ \t]*|\t+)([^\r\n]+)/im)?.[1]?.trim();
            const websiteLabel = /^(?:if b website go to|application (?:website|url|link))$/i;
            const hasWebsiteLabel = value => websiteLabel.test(value.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim());
            const websiteFields = [...(article?.querySelectorAll('tr, dt, th, td, label, strong, b, div, span, p') || [])]
              .filter(node => hasWebsiteLabel((node.cells?.[0]?.innerText ?? node.innerText).trim()));
            const validUrl = value => {
              try {
                const url = new URL(value);
                return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : undefined;
              } catch {
                return undefined;
              }
            };
            function linkIn(node) {
              if (!node) {
                return undefined;
              }
              const links = [node, ...node.querySelectorAll('a[href]')];
              return links.map(link => validUrl(link.href)).find(Boolean);
            }
            function urlInText(value) {
              const url = value?.match(/(?:https?:\/\/|www\.)[^\s<>"]+/i)?.[0];
              if (url) {
                return validUrl(/^www\./i.test(url) ? 'https://' + url : url);
              }
              const bare = value?.trim();
              if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#][^\s<>"]*)?$/i.test(bare || '')) {
                return validUrl('https://' + bare);
              }
            }
            let applicationUrl;
            for (const field of websiteFields) {
              const value = field.cells?.[1] ?? field.nextElementSibling ?? field.parentElement?.nextElementSibling;
              applicationUrl = linkIn(value) || urlInText(value?.innerText);
              if (applicationUrl) {
                break;
              }
            }
            if (!applicationUrl) {
              const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
              for (const [index, line] of lines.entries()) {
                const inline = line.match(/^(.*?(?:go to|application (?:website|url|link)))\s*:?\s*(\S.*)$/i);
                if (hasWebsiteLabel(line)) {
                  applicationUrl = urlInText(lines[index + 1]);
                }
                else if (inline && hasWebsiteLabel(inline[1])) {
                  applicationUrl = urlInText(inline[2]);
                }
                if (applicationUrl) {
                  break;
                }
              }
            }
            if (!applicationUrl && application?.classList.contains('panel')) {
              const apply = [...application.querySelectorAll('a[href]')]
                .find(link => /^(?:apply now|apply online|apply for (?:this|the) (?:job|position))\b/i.test(link.innerText.trim()) && validUrl(link.href));
              applicationUrl = validUrl(apply?.href);
            }
            const applicationDetails = [];
            for (const label of ['Application Delivery', 'Application Method', 'Application Instructions',
              'Additional Application Information', 'Application Documents Required', 'Required Documents']) {
              const value = fieldValue(new RegExp('^' + label + '\\s*:?$', 'i')) ||
                (application?.innerText || text).match(new RegExp(
                  '^[ \\t]*' + label + '[ \\t]*(?::[ \\t]*(?:\\r?\\n[ \\t]*)?|\\r?\\n[ \\t]*|\\t+)([^\\r\\n]+)', 'im',
                ))?.[1]?.trim();
              if (value) {
                applicationDetails.push({ label, value });
              }
            }
            const emailLabel = /^If\s+by\s+e[ -]?mail\s*,?\s*send\s+to\s*:?$/i;
            const emailField = fieldValue(emailLabel) ||
              (application?.innerText || text).match(
                /^[ \t]*If[ \t]+by[ \t]+e[ -]?mail[ \t]*,?[ \t]*send[ \t]+to[ \t]*:?[ \t]*(?:\r?\n[ \t]*)?([^\r\n]+)/im,
              )?.[1];
            const applicationEmail = emailField?.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/i)?.[0];
            return { description: text, duration, city, level, applicationDeadline, applicationDetails, applicationUrl, applicationEmail };
          }, { jobId: entry.jobId, title: entry.title }, { timeout: 5000 });
          if (!detail) {
            throw new Error('Popup did not match the selected listing');
          }
          const popupMonths = readMonths(detail.duration);
          const months = popupMonths.length ? popupMonths : readMonths(entry.duration);
          if (months.length && !months.includes(profile.duration)) {
            differentDuration++;
            candidates.delete(key);
          } else {
            if (!months.length) {
              missingDuration++;
            }
            const job = {
              title: entry.title, company: entry.company, location: entry.location || detail.city,
              level: entry.level || detail.level, applicationDeadline: entry.applicationDeadline || detail.applicationDeadline,
              jobId: entry.jobId, board, term: profile.term, duration: months.length ? profile.duration : undefined,
              description: detail.description, applicationDetails: detail.applicationDetails,
              applicationUrl: detail.applicationUrl, applicationEmail: detail.applicationEmail,
            };
            if ((profile.location && !job.location) || (profile.level && !job.level)) {
              missingCityOrLevel++;
            }
            jobs.push(job);
            candidates.delete(key);
          }
        } catch {
          skipped++;
          popupFailures[stage]++;
        }
        try {
          await closePosting();
        } catch {
          if (Date.now() >= scanDeadline) {
            interrupted = scanTimeoutMessage;
            break;
          }
          try {
            entries = await reopenBoard();
            if (!entries.length) {
              throw new Error('No results after reloading');
            }
            if (pageKey(entries) !== current) {
              pageNumber = 1;
            }
            direction = 1;
            traversal.clear();
            reopened = true;
            break;
          } catch {
            interrupted = 'A posting popup did not close and the results page could not be restored';
            break;
          }
        }
      }
      if (interrupted) {
        break;
      }
      if (seenJobs.size >= targets.size) {
        break;
      }
      if (Date.now() >= scanDeadline) {
        interrupted = scanTimeoutMessage;
        break;
      }
      if (reopened) {
        continue;
      }
      try {
        if (direction === -1 && pageNumber === 1) {
          break;
        }
        entries = await nextEntries(current, pageNumber, direction).catch(error => {
          if (direction === -1) {
            return null;
          }
          throw error;
        });
        if (!entries && direction === -1) {
          if (Date.now() >= scanDeadline) {
            break;
          }
          entries = await reopenBoard();
          traversal.clear();
          pageNumber = 1;
          direction = 1;
          continue;
        }
        if (!entries) {
          break;
        }
        if (traversal.has(pageKey(entries))) {
          interrupted = 'WaterlooWorks did not load a new results page';
          break;
        }
        pageNumber += direction;
      } catch {
        interrupted = 'Could not open the next WaterlooWorks results page';
        break;
      }
    }
    if (Date.now() >= scanDeadline && checked < targets.size) {
      interrupted ??= scanTimeoutMessage;
    }
    if (checked < targets.size) {
      interrupted ??= 'Some postings could not be reached for verification';
    }
    return { jobs: [...jobs, ...candidates.values()], skipped, popupFailures, missingDuration, checked, pagesChecked: seenPages.size, interrupted: interrupted ?? listWarning, differentDuration, differentLocationOrLevel, missingCityOrLevel };
  } finally {
    if (!signedInTab) {
      await page.close().catch(() => {});
    }
  }
}
