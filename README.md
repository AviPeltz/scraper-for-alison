# Gene MSA Scraper

A Puppeteer-based web scraper for extracting Multiple Sequence Alignment (MSA) data from the Soy Superpangenome Orthobrowser.

## Features

- Automated gene searching using IDs from CSV file
- Handles autocomplete suggestions
- Exports MSA data via clipboard API
- Saves data as FASTA files named after gene names
- Retry logic for failed attempts
- Progress tracking and time estimation
- Test mode for validation
- Headless and visible browser modes

## Prerequisites

- Node.js (v14 or higher)
- npm

## Installation

1. Install dependencies:
```bash
npm install
```

## Usage

### Basic Usage

Run the standard scraper (visible browser):
```bash
npm start
```

### Enhanced Version (Recommended)

Run the enhanced scraper with better error handling:
```bash
npm run start:enhanced
```

### Test Mode

Test with first 5 genes (visible browser):
```bash
npm test
```

Test with first 5 genes (headless):
```bash
npm run test:headless
```

### Production Mode

Run in headless mode for better performance:
```bash
npm run scrape:headless
```

## Input Format

The scraper expects a `genes.csv` file in the root directory with the following format:
```csv
"GeneName1","GeneID1"
"GeneName2","GeneID2"
...
```

Example:
```csv
"TauD","Medtr0021s0370"
"Pchitina","Medtr0027s0260"
```

## Output

- MSA data files are saved in the `./output` directory
- Files are named using the gene name from column 1 of the CSV (e.g., `TauD.fasta`)
- Failed genes are logged in `./output/failed/failed_genes.json`

## Configuration

You can modify these settings in the scraper files:

- `DELAY_BETWEEN_SEARCHES`: Time to wait between searches (default: 2000ms)
- `MAX_RETRIES`: Number of retry attempts for failed genes (default: 3)
- `TEST_LIMIT`: Number of genes to process in test mode (default: 5)

## Troubleshooting

### Clipboard Access Issues

If you encounter clipboard permission errors:
1. Run the scraper in visible mode (not headless)
2. Allow clipboard permissions when prompted by the browser
3. Make sure no other applications are blocking clipboard access

### Export Button Not Found

The scraper tries multiple strategies to find the Export button. If it still fails:
1. Check if the website structure has changed
2. Increase the wait time after page load
3. Run in visible mode to debug the issue

### Autocomplete Not Working

If autocomplete doesn't appear:
1. The scraper will still try to search directly
2. Check if the gene ID format is correct (should be lowercase)
3. Verify the website is loading properly

## Files

- `scraper.js` - Basic version of the scraper
- `scraper-enhanced.js` - Enhanced version with better error handling
- `parseCSV.js` - CSV parsing utility
- `genes.csv` - Input file with gene data
- `output/` - Directory containing exported FASTA files
- `output/failed/` - Directory containing failed gene logs

## Notes

- The scraper includes a 2-second delay between searches to be respectful to the server
- Progress is reported every 10 genes with time estimates
- The browser runs in non-headless mode by default so you can see what's happening
- Use `--headless` flag for production runs to improve performance 