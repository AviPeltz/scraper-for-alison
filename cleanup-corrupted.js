const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

async function findCorruptedFiles() {
  try {
    const outputDir = './output';
    const files = await fs.readdir(outputDir);
    const txtFiles = files.filter(file => file.endsWith('.txt'));
    
    console.log(`Checking ${txtFiles.length} files for corruption...`);
    
    const corruptedFiles = [];
    const validFiles = [];
    
    for (const file of txtFiles) {
      const filePath = path.join(outputDir, file);
      
      try {
        // Use the 'file' command to check file type
        const { stdout } = await execAsync(`file "${filePath}"`);
        
        if (stdout.includes('data') || 
            stdout.includes('PNG') || 
            stdout.includes('JPEG') || 
            stdout.includes('binary')) {
          corruptedFiles.push(file);
          console.log(`❌ CORRUPTED: ${file} - ${stdout.trim()}`);
        } else {
          validFiles.push(file);
          console.log(`✅ VALID: ${file}`);
        }
      } catch (err) {
        console.error(`Error checking ${file}:`, err.message);
      }
    }
    
    console.log(`\n=== SUMMARY ===`);
    console.log(`Total files: ${txtFiles.length}`);
    console.log(`Valid files: ${validFiles.length}`);
    console.log(`Corrupted files: ${corruptedFiles.length}`);
    
    if (corruptedFiles.length > 0) {
      console.log(`\nCorrupted files to clean up:`);
      corruptedFiles.forEach(file => console.log(`  - ${file}`));
      
      console.log(`\nTo remove corrupted files, run:`);
      console.log(`node cleanup-corrupted.js --remove`);
    }
    
    return { corruptedFiles, validFiles };
    
  } catch (err) {
    console.error('Error finding corrupted files:', err.message);
  }
}

async function removeCorruptedFiles(corruptedFiles) {
  console.log(`Removing ${corruptedFiles.length} corrupted files...`);
  
  for (const file of corruptedFiles) {
    try {
      const filePath = path.join('./output', file);
      await fs.unlink(filePath);
      console.log(`🗑️  Removed: ${file}`);
    } catch (err) {
      console.error(`Error removing ${file}:`, err.message);
    }
  }
  
  console.log(`✅ Cleanup complete!`);
}

async function main() {
  const shouldRemove = process.argv.includes('--remove');
  
  const { corruptedFiles, validFiles } = await findCorruptedFiles();
  
  if (shouldRemove && corruptedFiles.length > 0) {
    await removeCorruptedFiles(corruptedFiles);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { findCorruptedFiles, removeCorruptedFiles }; 