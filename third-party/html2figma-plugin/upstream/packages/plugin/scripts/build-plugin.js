#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import * as babel from '@babel/core';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Building Figma Plugin...');

const pluginDistDir = path.resolve(__dirname, '../dist');

if (!fs.existsSync(pluginDistDir)) {
    fs.mkdirSync(pluginDistDir, { recursive: true });
}

// Copy manifest.json
const manifestSrc = path.resolve(__dirname, '../manifest.json');
const manifestDest = path.resolve(pluginDistDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestSrc, 'utf8'));
manifest.main = 'code.js';
manifest.ui = 'ui.html';
fs.writeFileSync(manifestDest, JSON.stringify(manifest, null, 2));
console.log('Manifest copied.');

// Copy asset folder
const assetSrc = path.resolve(__dirname, '../asset');
const assetDest = path.resolve(pluginDistDir, 'asset');
if (fs.existsSync(assetSrc)) {
    if (!fs.existsSync(assetDest)) fs.mkdirSync(assetDest, { recursive: true });
    for (const file of fs.readdirSync(assetSrc)) {
        const srcPath = path.join(assetSrc, file);
        if (fs.statSync(srcPath).isFile()) {
            fs.copyFileSync(srcPath, path.join(assetDest, file));
        }
    }
    console.log('Assets copied.');
}

// Read the UI HTML (built by vite build:ui → dist/index.html)
const uiHtmlPath = path.resolve(pluginDistDir, 'index.html');
if (!fs.existsSync(uiHtmlPath)) {
    console.error('UI HTML not found at', uiHtmlPath);
    console.error('Run "pnpm run build:ui" first.');
    process.exit(1);
}
const uiHtmlContent = fs.readFileSync(uiHtmlPath, 'utf8');

// Rename to ui.html
fs.writeFileSync(path.resolve(pluginDistDir, 'ui.html'), uiHtmlContent);
// Remove the intermediate index.html
fs.unlinkSync(uiHtmlPath);
console.log('UI HTML processed.');

// Process code.js — inject UI HTML and apply Babel transforms
const codePath = path.resolve(pluginDistDir, 'code.js');
if (!fs.existsSync(codePath)) {
    console.error('code.js not found. Run "pnpm run build:code" first.');
    process.exit(1);
}

let codeContent = fs.readFileSync(codePath, 'utf8');

// Escape HTML for template literal embedding
const escapedHtml = uiHtmlContent
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/\r?\n/g, '\\n')
    .replace(/\r/g, '\\r');

codeContent = codeContent.replace(/__html__/g, '`' + escapedHtml + '`');

// Babel transform (preserve async/await)
console.log('Applying Babel transforms...');
try {
    const result = babel.transformSync(codeContent, {
        presets: [
            ['@babel/preset-env', {
                targets: { chrome: '80' },
                modules: false,
                exclude: ['@babel/plugin-transform-async-to-generator'],
            }],
        ],
        plugins: [
            ['@babel/plugin-transform-runtime', { helpers: false, regenerator: false }],
        ],
    });
    if (result?.code) {
        codeContent = result.code;
    }
} catch (e) {
    console.warn('Babel transform failed, using original:', e.message);
}

const header = `// Html2Figma Plugin\n// Built: ${new Date().toISOString()}\n\n`;
fs.writeFileSync(codePath, header + codeContent);
console.log('code.js processed.');

// Build info
fs.writeFileSync(
    path.resolve(pluginDistDir, 'build-info.json'),
    JSON.stringify({
        version: JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).version,
        buildTime: new Date().toISOString(),
    }, null, 2)
);

console.log('Plugin build completed!');
console.log(`Output: ${pluginDistDir}`);
