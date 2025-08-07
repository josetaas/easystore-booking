#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

async function minifyInjectScript() {
  const inputFile = path.join(__dirname, 'inject.js');
  const outputFile = path.join(__dirname, 'inject.min.js');

  try {
    // Read the original file
    console.log('Reading inject.js...');
    const code = fs.readFileSync(inputFile, 'utf8');
    
    // Minify the code
    console.log('Minifying...');
    const result = await minify(code, {
      compress: {
        drop_console: false, // Keep console logs for debugging
        drop_debugger: true,
        passes: 2
      },
      mangle: {
        toplevel: true,
        reserved: ['CONFIG'] // Preserve CONFIG object name
      },
      format: {
        comments: false
      }
    });

    if (result.error) {
      throw result.error;
    }

    // Write the minified file
    fs.writeFileSync(outputFile, result.code);
    
    // Calculate size reduction
    const originalSize = fs.statSync(inputFile).size;
    const minifiedSize = fs.statSync(outputFile).size;
    const reduction = ((originalSize - minifiedSize) / originalSize * 100).toFixed(2);
    
    console.log(`✅ Minification complete!`);
    console.log(`   Original: ${(originalSize / 1024).toFixed(2)} KB`);
    console.log(`   Minified: ${(minifiedSize / 1024).toFixed(2)} KB`);
    console.log(`   Reduction: ${reduction}%`);
    console.log(`   Output: ${outputFile}`);

  } catch (error) {
    console.error('❌ Minification failed:', error.message);
    process.exit(1);
  }
}

// Run the minification
minifyInjectScript();