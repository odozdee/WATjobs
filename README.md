# WATjobs

WaterlooWorks Searching Assistant

WATjobs helps students filter co-op postings and compare jobs based on their interests and skills. Sign in to WaterlooWorks through the embedded Steel browser, complete 2FA, and enter your search preferences.

## Features

- Filter by work term, duration, city, and job level
- Rank postings using your program, preferred job titles, and skills
- View the top three results and expand the rest
- Read job summaries and application instructions
- Use Claude to suggest related job titles and skill terms
- Save searches in your browser and reopen them later

## Run locally

Requires Node.js 24 or newer.

Install dependencies:

```bash
npm install
```

Create a `.env` file in the project folder:

```dotenv
STEEL_API_KEY=your_steel_key
STEEL_HEADLESS=0
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_MODEL=your_claude_model_id
```

The Anthropic settings are optional. Without them, WATjobs uses your entered terms for keyword matching.

Start the app:

```bash
npm start
```

Open http://127.0.0.1:3000 and click **Connect**. Sign in to WaterlooWorks and complete 2FA, then choose a job board, enter your preferences, and click **Find matches**.

## Notes

Some postings may have incomplete details. Confirm deadlines, requirements, and application instructions in WaterlooWorks using the displayed job ID.

Saved searches stay in the same browser and site address. Clearing browser data removes them.
