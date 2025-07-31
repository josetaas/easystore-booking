#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read the inject.js file
const injectPath = path.join(__dirname, 'inject.js');
const injectContent = fs.readFileSync(injectPath, 'utf8');

// Basic minification - remove comments and extra whitespace
function minifyJS(code) {
    // Remove single-line comments
    code = code.replace(/\/\/.*$/gm, '');
    
    // Remove multi-line comments
    code = code.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // Remove extra whitespace and newlines
    code = code.replace(/\s+/g, ' ');
    
    // Remove space around operators
    code = code.replace(/\s*([=+\-*/<>!&|,;:{}()\[\]"])\s*/g, '$1');
    
    // Fix some cases where we need spaces
    code = code.replace(/\)(\w)/g, ') $1');
    code = code.replace(/(\w)\{/g, '$1 {');
    code = code.replace(/\}(\w)/g, '} $1');
    code = code.replace(/function\(/g, 'function (');
    code = code.replace(/if\(/g, 'if (');
    code = code.replace(/for\(/g, 'for (');
    code = code.replace(/while\(/g, 'while (');
    code = code.replace(/catch\(/g, 'catch (');
    code = code.replace(/switch\(/g, 'switch (');
    
    return code.trim();
}

// Escape for JSON
function escapeForJSON(str) {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

// Minify the code
const minified = minifyJS(injectContent);

// Create the HTML snippet with inline script
const htmlSnippet = `<script>${minified}</script>`;

// Escape for JSON
const escaped = escapeForJSON(htmlSnippet);

// Create output with instructions
const output = `
=== MINIFIED AND ESCAPED SNIPPET FOR EASYSTORE ===

Copy the content between the START and END markers below and paste it into your Postman request body:

=== START ===
${escaped}
=== END ===

File size comparison:
- Original: ${injectContent.length} characters
- Minified: ${minified.length} characters
- Reduction: ${Math.round((1 - minified.length / injectContent.length) * 100)}%

Instructions for Postman:
1. Copy the escaped content between START and END markers above
2. In Postman, use this in your request body for the snippet field
3. This will embed the booking widget directly in the page without external script loading

Alternative: If you need just the minified JavaScript (no HTML wrapper):
=== MINIFIED JS START ===
${escapeForJSON(minified)}
=== MINIFIED JS END ===
`;

// Write to output file
const outputPath = path.join(__dirname, 'inject-snippet.txt');
fs.writeFileSync(outputPath, output);

console.log(`✅ Snippet prepared successfully!`);
console.log(`📄 Output saved to: ${outputPath}`);
console.log(`📏 Original size: ${injectContent.length} characters`);
console.log(`📏 Minified size: ${minified.length} characters`);
console.log(`📉 Size reduction: ${Math.round((1 - minified.length / injectContent.length) * 100)}%`);
console.log(`\n💡 Open ${outputPath} to copy the escaped snippet for Postman`);