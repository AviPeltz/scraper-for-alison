const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { parseGenesCSV } = require('./parseCSV');

// Configuration
const BASE_URL = 'https://resources.michael.salk.edu/misc/soy_superpangenome_orthobrowser_v3/index.html';
const OUTPUT_DIR = './output';
const FAILED_DIR = './output/failed';
const DELAY_BETWEEN_SEARCHES = 2000;
const MAX_RETRIES = 3;
const HEADLESS = process.argv.includes('--headless');
const TEST_MODE = process.argv.includes('--test');
const TEST_LIMIT = 5; // Number of genes to process in test mode

async function ensureDirectories() {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.mkdir(FAILED_DIR, { recursive: true });
    console.log(`Output directories ready`);
  } catch (err) {
    console.error('Error creating directories:', err);
  }
}

async function saveFailedGene(gene, error) {
  const failedPath = path.join(FAILED_DIR, 'failed_genes.json');
  let failedGenes = [];
  
  try {
    const existingData = await fs.readFile(failedPath, 'utf-8');
    failedGenes = JSON.parse(existingData);
  } catch (err) {
    // File doesn't exist yet, that's okay
  }
  
  failedGenes.push({
    gene: gene,
    error: error.message,
    timestamp: new Date().toISOString()
  });
  
  await fs.writeFile(failedPath, JSON.stringify(failedGenes, null, 2));
}

function getFileName(geneName) {
  // Handle NA or empty gene names
  if (!geneName || geneName.trim() === '' || geneName.toLowerCase() === 'na') {
    const timestamp = Date.now();
    return `unknown_gene_${timestamp}.txt`;
  }
  
  // Clean up the gene name to be filesystem-friendly
  const cleanName = geneName.replace(/[<>:"/\\|?*]/g, '_').trim();
  return `${cleanName}.txt`;
}

function isValidMSAData(data) {
  // Check if data is a string and not binary
  if (typeof data !== 'string') {
    return false;
  }
  
  // Check for common binary file signatures
  if (data.startsWith('\x89PNG') || 
      data.startsWith('\xFF\xD8\xFF') || // JPEG
      data.startsWith('GIF8') ||
      data.startsWith('BM') || // BMP
      data.includes('\x00') || // Contains null bytes (likely binary)
      data.includes('\uFFFD')) { // Contains replacement characters (encoding issues)
    return false;
  }
  
  // Must be at least 100 characters
  if (data.length < 100) {
    return false;
  }
  
  // Should contain FASTA headers (>) or tab-separated data
  const hasFastaHeaders = data.includes('>');
  const hasTabData = data.includes('\t');
  
  // Should contain DNA/RNA sequences
  const hasSequenceData = /[ATCGN-]{10,}/i.test(data) || // DNA sequences
                         /[ACGUN-]{10,}/i.test(data);    // RNA sequences
  
  return (hasFastaHeaders || hasTabData) && hasSequenceData;
}

async function createFailedFile(gene) {
  try {
    const fileName = getFileName(gene.name);
    const failedFileName = fileName.replace('.txt', '_FAILED.txt');
    const filePath = path.join(OUTPUT_DIR, failedFileName);
    const failedContent = `FAILED TO RETRIEVE MSA DATA\nGene: ${gene.name}\nID: ${gene.id}\nTimestamp: ${new Date().toISOString()}`;
    await fs.writeFile(filePath, failedContent);
    console.log(`✗ Created failed file: ${failedFileName}`);
  } catch (err) {
    console.error('Error creating failed file:', err.message);
  }
}

async function searchAndExportGene(page, gene, retryCount = 0) {
  // Set up comprehensive network interception to catch MSA data BEFORE any navigation
  let msaDataFromNetwork = null;
  let msaRequestUrl = null;
  
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('msa') || url.includes('export') || url.includes('fasta')) {
      console.log('MSA-related request:', url);
      msaRequestUrl = url;
    }
  });
  
  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    
    // Only process text content types and specific MSA/FASTA URLs
    if ((url.includes('msa') && url.includes('.tsv')) || 
        url.includes('fasta') || 
        (url.includes('export') && contentType.includes('text')) ||
        contentType.includes('text/plain') ||
        contentType.includes('text/tab-separated-values')) {
      
      // Skip binary content types
      if (contentType.includes('image/') || 
          contentType.includes('application/octet-stream') ||
          contentType.includes('application/pdf')) {
        console.log(`Skipping binary content from ${url} (${contentType})`);
        return;
      }
      
      try {
        const text = await response.text();
        console.log(`Response from ${url}: ${text.length} characters, content-type: ${contentType}`);
        
        // More robust FASTA/MSA detection
        if (text.length > 100 && 
            (text.includes('>') || text.includes('\t')) && 
            (text.includes('ATCG') || text.includes('atcg') || 
             text.includes('ACGT') || text.includes('acgt') ||
             text.match(/^[ATCGN-]+$/m))) {
          console.log('MSA data intercepted from network');
          msaDataFromNetwork = text;
        }
      } catch (err) {
        console.log('Could not read response text:', err.message);
      }
    }
  });

  try {
    console.log(`\nProcessing gene: ${gene.name} (ID: ${gene.id}) - Attempt ${retryCount + 1}`);
    
    // Navigate to the page
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for and clear the search input
    await page.waitForSelector('#searchInput', { visible: true, timeout: 10000 });
    
    // Clear existing text and type new search
    await page.evaluate(() => {
      document.querySelector('#searchInput').value = '';
    });
    await page.type('#searchInput', gene.id.toLowerCase(), { delay: 50 });
    
    // Wait for autocomplete with better error handling
    let autocompleteFound = false;
    try {
      await page.waitForSelector('.ui-autocomplete', { visible: true, timeout: 5000 });
      autocompleteFound = true;
    } catch (err) {
      console.log('Autocomplete not found, trying direct search...');
    }
    
         if (autocompleteFound) {
       await new Promise(resolve => setTimeout(resolve, 500));
      
      // Try to click the first autocomplete result
      const clicked = await page.evaluate(() => {
        const firstItem = document.querySelector('.ui-autocomplete .ui-menu-item:first-child');
        if (firstItem) {
          firstItem.click();
          return true;
        }
        return false;
      });
      
      if (clicked) {
        console.log('Clicked autocomplete result');
      }
    }
    
    // Submit the search
    await page.click('button[type="submit"]');
    
         // Wait for page to load with results and network requests to complete
     await new Promise(resolve => setTimeout(resolve, 3000));
     
         // Check if we already have MSA data from network interception
    if (msaDataFromNetwork && msaDataFromNetwork.length > 1000) {
      console.log('✓ Using MSA data from network interception (no UI interaction needed)');
      
      // Validate the data before saving
      if (!isValidMSAData(msaDataFromNetwork)) {
        console.log('✗ Network data appears to be binary or invalid, skipping');
        msaDataFromNetwork = null; // Reset to try UI method
      } else {
        const fileName = getFileName(gene.name);
        const filePath = path.join(OUTPUT_DIR, fileName);
        await fs.writeFile(filePath, msaDataFromNetwork);
        console.log(`✓ Saved MSA data to ${fileName} (${msaDataFromNetwork.length} characters)`);
        return true;
      }
    }
    
         // If no network data, try to find and click the Export dropdown
     console.log('Looking for Export dropdown...');
     const exportClicked = await page.evaluate(() => {
       // Try to find the Export dropdown by the exact structure provided
       const strategies = [
         () => document.querySelector('#navbarDropdown'),
         () => document.querySelector('a.nav-link.dropdown-toggle[data-bs-toggle="dropdown"]'),
         () => document.querySelector('li.nav-item.dropdown a.nav-link'),
         () => Array.from(document.querySelectorAll('a.nav-link.dropdown-toggle')).find(el => 
           el.textContent.trim() === 'Export'
         ),
         () => Array.from(document.querySelectorAll('a')).find(el => 
           el.textContent.trim() === 'Export' && el.hasAttribute('data-bs-toggle')
         )
       ];
       
       for (const strategy of strategies) {
         const element = strategy();
         if (element) {
           console.log('Found export button:', element.className, element.id);
           element.click();
           return true;
         }
       }
       return false;
     });
     
         if (!exportClicked) {
      console.log('Could not find Export dropdown - checking if we have network data as fallback');
      if (msaDataFromNetwork && msaDataFromNetwork.length > 50 && isValidMSAData(msaDataFromNetwork)) {
        console.log('✓ Using available network data as fallback');
        const fileName = getFileName(gene.name);
        const filePath = path.join(OUTPUT_DIR, fileName);
        await fs.writeFile(filePath, msaDataFromNetwork);
        console.log(`✓ Saved MSA data to ${fileName} (${msaDataFromNetwork.length} characters)`);
        return true;
      } else {
         console.log('No Export dropdown and no usable network data - skipping this gene');
         await createFailedFile(gene);
         return false;
       }
     }
     
     // Wait for dropdown to appear
     await new Promise(resolve => setTimeout(resolve, 500));
     
     // Click MSA button using the specific ID
     console.log('Clicking MSA button...');
     const msaClicked = await page.evaluate(() => {
       // Store reference to original clipboard API
       window.originalClipboard = navigator.clipboard;
       
       // Try to find the MSA button by ID first, then by other methods
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
     
          if (!msaClicked) {
       console.log('Could not find MSA button - skipping this gene');
       await createFailedFile(gene);
       return false;
     }
     
     // Wait a short time for the clipboard operation to complete
     console.log('Waiting for MSA data to be copied to clipboard...');
     await new Promise(resolve => setTimeout(resolve, 1000));
     
     // Try multiple methods to get MSA data immediately
     let msaData = null;
     
     // First, check if we intercepted data from network
     if (msaDataFromNetwork) {
       console.log('Using MSA data from network interception');
       msaData = msaDataFromNetwork;
     } else {
       // Try to read from clipboard with permission handling
       console.log('Reading from clipboard...');
       
       try {
         msaData = await page.evaluate(async () => {
           try {
             // Try custom clipboard data first
             if (window.clipboardData) {
               console.log('Using custom clipboard data');
               return window.clipboardData;
             }
             
             const clipboardText = await navigator.clipboard.readText();
             console.log('Clipboard content length:', clipboardText.length);
             if (clipboardText.length > 10) {
               console.log('Clipboard preview:', clipboardText.substring(0, 100));
             }
             return clipboardText;
           } catch (err) {
             console.error('Clipboard read error in page:', err);
             return null;
           }
         });
       } catch (clipboardError) {
         console.log('Clipboard read failed, trying alternative methods...');
       }
       
       // If clipboard failed, look for data in the page
       if (!msaData || msaData.length < 10) {
         msaData = await page.evaluate(() => {
           // Check for textarea or pre elements
           const textarea = document.querySelector('textarea');
           if (textarea && textarea.value && textarea.value.includes('>')) {
             return textarea.value;
           }
           
           const pre = document.querySelector('pre');
           if (pre && pre.textContent && pre.textContent.includes('>')) {
             return pre.textContent;
           }
           
           // Check for any elements that might contain FASTA data
           const allElements = document.querySelectorAll('*');
           for (const el of allElements) {
             if (el.textContent && el.textContent.includes('>') && 
                 el.textContent.length > 50 && el.textContent.includes('ATCG')) {
               return el.textContent;
             }
           }
           
           return null;
         });
       }
     }
     
             if (msaData && msaData.trim() && isValidMSAData(msaData)) {
      // Save to file immediately as .txt file
      const fileName = getFileName(gene.name);
      const filePath = path.join(OUTPUT_DIR, fileName);
      await fs.writeFile(filePath, msaData);
      console.log(`✓ Saved MSA data to ${fileName} (${msaData.length} characters)`);
      return true;
    } else {
      if (msaData && msaData.trim() && !isValidMSAData(msaData)) {
        console.log('✗ Retrieved data appears to be binary or invalid format - creating failed file');
      } else {
        console.log('No MSA data retrieved - creating failed file');
      }
      await createFailedFile(gene);
      return false;
    }
    
  } catch (error) {
    console.error(`Error processing gene ${gene.name}:`, error.message);
    
         // Retry logic
     if (retryCount < MAX_RETRIES - 1) {
       console.log(`Retrying gene ${gene.name}...`);
       await new Promise(resolve => setTimeout(resolve, 1000));
       return await searchAndExportGene(page, gene, retryCount + 1);
    } else {
      // Create failed file and save failed gene info
      await createFailedFile(gene);
      await saveFailedGene(gene, error);
      return false;
    }
  }
}

async function main() {
  console.log('Starting Enhanced Gene MSA Scraper...');
  console.log(`Mode: ${HEADLESS ? 'Headless' : 'Visible'}`);
  console.log(`Test mode: ${TEST_MODE ? `Yes (${TEST_LIMIT} genes)` : 'No'}`);
  
  // Ensure directories exist
  await ensureDirectories();
  
  // Parse the CSV file
  let genes = await parseGenesCSV();
  
  // Limit genes in test mode
  if (TEST_MODE) {
    genes = genes.slice(0, TEST_LIMIT);
    console.log(`Test mode: Processing only first ${TEST_LIMIT} genes`);
  }
  
  console.log(`Found ${genes.length} genes to process`);
  
  // Launch Puppeteer
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args: [
      '--enable-features=ClipboardRead',
      '--enable-clipboard-read',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
    defaultViewport: null
  });
  
  try {
    const page = await browser.newPage();
    
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Grant clipboard permissions more thoroughly
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(BASE_URL, ['clipboard-read', 'clipboard-write']);
    
    // Also grant permissions for the specific page
    await page.evaluateOnNewDocument(() => {
      // Override clipboard API to ensure it works
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          readText: async () => {
            return window.clipboardData || '';
          },
          writeText: async (text) => {
            window.clipboardData = text;
            return Promise.resolve();
          }
        }
      });
    });
    
    // Handle alert dialogs by automatically clicking OK
    page.on('dialog', async dialog => {
      console.log(`Alert detected: ${dialog.message()}`);
      await dialog.accept();
    });
    
    // Add console log listener for debugging
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('Page error:', msg.text());
      }
    });
    
    // Process each gene
    let successCount = 0;
    let failCount = 0;
    const startTime = Date.now();
    
    for (let i = 0; i < genes.length; i++) {
      const gene = genes[i];
      console.log(`\n${'='.repeat(50)}`);
      console.log(`Progress: ${i + 1}/${genes.length} (${Math.round((i + 1) / genes.length * 100)}%)`);
      
      const success = await searchAndExportGene(page, gene);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
      
             // Delay between searches
       if (i < genes.length - 1) {
         await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_SEARCHES));
       }
      
      // Progress report every 10 genes
      if ((i + 1) % 10 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (i + 1) / elapsed;
        const remaining = (genes.length - i - 1) / rate;
        console.log(`\nStatus: ${successCount} successful, ${failCount} failed`);
        console.log(`Estimated time remaining: ${Math.round(remaining / 60)} minutes`);
      }
    }
    
    // Final report
    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`\n${'='.repeat(50)}`);
         console.log(`✅ Scraping complete!`);
     console.log(`Successfully processed: ${successCount}/${genes.length} genes`);
     console.log(`Failed: ${failCount} genes`);
     console.log(`Total time: ${Math.round(totalTime / 60)} minutes`);
     console.log(`Output files saved as .txt format in: ${OUTPUT_DIR}`);
     
     if (failCount > 0) {
       console.log(`\nFailed genes saved to: ${path.join(FAILED_DIR, 'failed_genes.json')}`);
     }
    
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await browser.close();
  }
}

// Run the scraper
main().catch(console.error); 