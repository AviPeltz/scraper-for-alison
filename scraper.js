const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { parseGenesCSV } = require('./parseCSV');

// Configuration
const BASE_URL = 'https://resources.michael.salk.edu/misc/soy_superpangenome_orthobrowser_v3/index.html';
const OUTPUT_DIR = './output';
const DELAY_BETWEEN_SEARCHES = 2000; // 2 seconds between searches to be respectful

async function ensureOutputDirectory() {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    console.log(`Output directory ready: ${OUTPUT_DIR}`);
  } catch (err) {
    console.error('Error creating output directory:', err);
  }
}

async function searchAndExportGene(page, gene) {
  try {
    console.log(`\nProcessing gene: ${gene.name} (ID: ${gene.id})`);
    
    // Navigate to the page with a fresh start
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    
    // Wait for the search input to be available
    await page.waitForSelector('#searchInput', { visible: true });
    
    // Clear the search input and type the gene ID
    await page.click('#searchInput', { clickCount: 3 }); // Triple-click to select all
    await page.type('#searchInput', gene.id.toLowerCase());
    
    // Wait for autocomplete to appear
    console.log('Waiting for autocomplete...');
    await page.waitForSelector('.ui-autocomplete', { visible: true, timeout: 5000 });
    
    // Small delay to ensure autocomplete is fully loaded
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Click on the first autocomplete result
    const firstResult = await page.$('.ui-autocomplete .ui-menu-item:first-child');
    if (firstResult) {
      console.log('Clicking first autocomplete result...');
      await firstResult.click();
    } else {
      console.log('No autocomplete results found, proceeding with search...');
    }
    
    // Click the search button
    await page.click('button[type="submit"]');
    
    // Wait for results to load
    await new Promise(resolve => setTimeout(resolve, 3000)); // Give time for the page to load results
    
    // Find and click the Export dropdown
    console.log('Looking for Export dropdown...');
    const exportClicked = await page.evaluate(() => {
      const strategies = [
        () => document.querySelector('#navbarDropdown'),
        () => document.querySelector('a[data-bs-toggle="dropdown"]'),
        () => document.querySelector('.nav-link.dropdown-toggle'),
        () => Array.from(document.querySelectorAll('a')).find(el => 
          el.textContent.trim() === 'Export' && el.classList.contains('dropdown-toggle')
        )
      ];
      
      for (const strategy of strategies) {
        const element = strategy();
        if (element) {
          element.click();
          return true;
        }
      }
      return false;
    });
    
    if (!exportClicked) {
      throw new Error('Export dropdown not found');
    }
    
    // Wait for dropdown menu to appear
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Click MSA button
    console.log('Clicking MSA button...');
    const msaOption = await page.evaluate(() => {
      const strategies = [
        () => document.querySelector('#msa_button'),
        () => document.querySelector('button.export-button#msa_button'),
        () => Array.from(document.querySelectorAll('.export-button')).find(el => 
          el.textContent.trim() === 'MSA'
        ),
        () => Array.from(document.querySelectorAll('button')).find(el => 
          el.textContent.trim() === 'MSA'
        )
      ];
      
      for (const strategy of strategies) {
        const element = strategy();
        if (element) {
          element.click();
          return true;
        }
      }
      return false;
    });
    
    if (!msaOption) {
      throw new Error('MSA button not found');
    }
    
    // Wait for clipboard operation
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Read from clipboard using Puppeteer's clipboard API
    console.log('Reading from clipboard...');
    const msaData = await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch (err) {
        console.error('Clipboard read error:', err);
        return null;
      }
    });
    
    if (msaData) {
      // Save to file
      const fileName = `${gene.name}.fasta`;
      const filePath = path.join(OUTPUT_DIR, fileName);
      await fs.writeFile(filePath, msaData);
      console.log(`✓ Saved MSA data to ${fileName}`);
      return true;
    } else {
      console.error(`✗ No MSA data retrieved for ${gene.name}`);
      return false;
    }
    
  } catch (error) {
    console.error(`Error processing gene ${gene.name}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('Starting Gene MSA Scraper...');
  
  // Ensure output directory exists
  await ensureOutputDirectory();
  
  // Parse the CSV file
  const genes = await parseGenesCSV();
  console.log(`Found ${genes.length} genes to process`);
  
  // Launch Puppeteer with clipboard permissions
  const browser = await puppeteer.launch({
    headless: false, // Set to false to see the browser in action
    args: [
      '--enable-features=ClipboardRead',
      '--enable-clipboard-read',
    ],
    defaultViewport: null
  });
  
  try {
    const page = await browser.newPage();
    
    // Grant clipboard permissions
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(BASE_URL, ['clipboard-read', 'clipboard-write']);
    
    // Process each gene
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < genes.length; i++) {
      const gene = genes[i];
      console.log(`\nProgress: ${i + 1}/${genes.length}`);
      
      const success = await searchAndExportGene(page, gene);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
      
      // Delay between searches (except for the last one)
      if (i < genes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_SEARCHES));
      }
    }
    
    console.log(`\n✅ Scraping complete!`);
    console.log(`Successfully processed: ${successCount}/${genes.length} genes`);
    console.log(`Failed: ${failCount} genes`);
    
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await browser.close();
  }
}

// Run the scraper
main().catch(console.error); 