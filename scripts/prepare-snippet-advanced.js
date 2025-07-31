#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

async function prepareSnippet() {
    // Read the inject.js file
    const injectPath = path.join(__dirname, 'inject.js');
    const injectContent = fs.readFileSync(injectPath, 'utf8');

    // Minify using terser
    const minified = await minify(injectContent, {
        compress: {
            drop_console: false, // Keep console logs for debugging
            drop_debugger: true,
            dead_code: true,
            unused: true
        },
        mangle: {
            toplevel: true,
            reserved: ['EasyStore', 'jQuery', '$'] // Don't mangle these globals
        },
        format: {
            comments: false
        }
    });

    if (minified.error) {
        console.error('Minification error:', minified.error);
        return;
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

    const minifiedCode = minified.code;

    // Create the HTML snippet with inline script
    const htmlSnippet = `<script>${minifiedCode}</script>`;

    // Escape for JSON
    const escaped = escapeForJSON(htmlSnippet);

    // Create output with instructions
    const output = `
=== ADVANCED MINIFIED AND ESCAPED SNIPPET FOR EASYSTORE ===

Copy the content between the START and END markers below and paste it into your Postman request body:

=== START ===
${escaped}
=== END ===

File size comparison:
- Original: ${injectContent.length} characters
- Minified: ${minifiedCode.length} characters
- Reduction: ${Math.round((1 - minifiedCode.length / injectContent.length) * 100)}%

Instructions for Postman:
1. Copy the escaped content between START and END markers above
2. In Postman, create a request to update your EasyStore snippet
3. Use this escaped content as the value for the snippet field in your JSON body
4. Example JSON body:
   {
     "snippet": {
       "content": "PASTE_ESCAPED_CONTENT_HERE"
     }
   }

Benefits of inline snippet:
- No external script loading delay
- Cart button hidden immediately
- Calendar appears instantly
- Better user experience

Alternative: If you need just the minified JavaScript (no HTML wrapper):
=== MINIFIED JS START ===
${escapeForJSON(minifiedCode)}
=== MINIFIED JS END ===
`;

    // Write to output file
    const outputPath = path.join(__dirname, 'inject-snippet-advanced.txt');
    fs.writeFileSync(outputPath, output);

    console.log(`✅ Advanced snippet prepared successfully!`);
    console.log(`📄 Output saved to: ${outputPath}`);
    console.log(`📏 Original size: ${injectContent.length} characters`);
    console.log(`📏 Minified size: ${minifiedCode.length} characters`);
    console.log(`📉 Size reduction: ${Math.round((1 - minifiedCode.length / injectContent.length) * 100)}%`);
    console.log(`\n💡 Open ${outputPath} to copy the escaped snippet for Postman`);
}

prepareSnippet().catch(console.error);