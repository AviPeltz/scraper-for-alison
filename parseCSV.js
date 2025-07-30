const fs = require('fs');
const { parse } = require('csv-parse');

async function parseGenesCSV(filePath = './genes.csv') {
  return new Promise((resolve, reject) => {
    const genes = [];
    
    fs.createReadStream(filePath)
      .pipe(parse({
        columns: false,
        skip_empty_lines: true,
        trim: true
      }))
      .on('data', (row) => {
        // Each row contains [geneName, geneId]
        if (row.length >= 2) {
          const geneName = row[0].replace(/"/g, '').trim();
          const geneId = row[1].replace(/"/g, '').trim();
          
          // Skip empty or NA entries
          if (geneName && geneId && geneName !== 'NA' && geneId !== 'NA') {
            genes.push({
              name: geneName,
              id: geneId
            });
          }
        }
      })
      .on('error', (err) => {
        reject(err);
      })
      .on('end', () => {
        console.log(`Parsed ${genes.length} genes from CSV`);
        resolve(genes);
      });
  });
}

module.exports = { parseGenesCSV }; 