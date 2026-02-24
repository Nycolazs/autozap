'use strict';

const fs = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');

const FULL_ICON_SVG = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="126" y1="128" x2="898" y2="900" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0B5BD3"/>
      <stop offset="0.5" stop-color="#0A7BC2"/>
      <stop offset="1" stop-color="#0EAD7A"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(276 216) rotate(47) scale(470 470)">
      <stop stop-color="#B3E5FF" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#B3E5FF" stop-opacity="0"/>
    </radialGradient>
    <filter id="cardShadow" x="220" y="220" width="612" height="612" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#052f58" flood-opacity="0.22"/>
    </filter>
    <linearGradient id="bolt" x1="454" y1="336" x2="674" y2="692" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFE47C"/>
      <stop offset="1" stop-color="#FF9A2F"/>
    </linearGradient>
  </defs>

  <rect x="64" y="64" width="896" height="896" rx="232" fill="url(#bg)"/>
  <rect x="64" y="64" width="896" height="896" rx="232" fill="url(#sheen)"/>

  <g filter="url(#cardShadow)">
    <rect x="228" y="238" width="568" height="430" rx="176" fill="#FFFFFF"/>
    <path d="M378 644L302 798L486 680L378 644Z" fill="#FFFFFF"/>
  </g>

  <path d="M568 336L454 522H548L478 692L674 454H574L638 336H568Z" fill="url(#bolt)"/>

  <circle cx="704" cy="694" r="90" fill="#E6F4FF"/>
  <path d="M662 694L694 726L746 664" stroke="#0B5BD3" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

const FOREGROUND_GLYPH_SVG = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bolt" x1="456" y1="316" x2="672" y2="676" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFE47C"/>
      <stop offset="1" stop-color="#FF9A2F"/>
    </linearGradient>
    <filter id="glyphShadow" x="220" y="220" width="612" height="612" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#001B3A" flood-opacity="0.18"/>
    </filter>
  </defs>

  <g filter="url(#glyphShadow)">
    <rect x="228" y="238" width="568" height="430" rx="176" fill="#FFFFFF"/>
    <path d="M378 644L302 798L486 680L378 644Z" fill="#FFFFFF"/>
  </g>
  <path d="M568 336L454 522H548L478 692L674 454H574L638 336H568Z" fill="url(#bolt)"/>
</svg>
`;

const fullIconTargets = [
  { size: 1024, file: 'mobile-expo/assets/icon.png' },
  { size: 1024, file: 'mobile-expo/assets/splash-icon.png' },
  { size: 1024, file: 'electron/assets/icon.png' },
  { size: 512, file: 'public/icon-512.png' },
  { size: 192, file: 'public/icon-192.png' },
  { size: 180, file: 'public/icon-180.png' },
  { size: 48, file: 'mobile-expo/assets/favicon.png' },
];

const androidLauncherTargets = [
  { size: 48, folder: 'mipmap-mdpi' },
  { size: 72, folder: 'mipmap-hdpi' },
  { size: 96, folder: 'mipmap-xhdpi' },
  { size: 144, folder: 'mipmap-xxhdpi' },
  { size: 192, folder: 'mipmap-xxxhdpi' },
];

const androidForegroundTargets = [
  { size: 108, folder: 'mipmap-mdpi' },
  { size: 162, folder: 'mipmap-hdpi' },
  { size: 216, folder: 'mipmap-xhdpi' },
  { size: 324, folder: 'mipmap-xxhdpi' },
  { size: 432, folder: 'mipmap-xxxhdpi' },
];

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeSvgArtifacts() {
  const fullSvgPath = path.join(ROOT, 'branding', 'autozap-icon.svg');
  const glyphSvgPath = path.join(ROOT, 'branding', 'autozap-glyph.svg');
  await ensureDir(fullSvgPath);
  await fs.writeFile(fullSvgPath, `${FULL_ICON_SVG.trim()}\n`, 'utf8');
  await fs.writeFile(glyphSvgPath, `${FOREGROUND_GLYPH_SVG.trim()}\n`, 'utf8');
}

async function renderPng(svg, size, outFile) {
  const outPath = path.join(ROOT, outFile);
  await ensureDir(outPath);
  await sharp(Buffer.from(svg))
    .resize(size, size, { fit: 'contain' })
    .png()
    .toFile(outPath);
}

async function writeFullIconAssets() {
  for (const target of fullIconTargets) {
    await renderPng(FULL_ICON_SVG, target.size, target.file);
  }
}

async function writeExpoAdaptiveIcon() {
  await renderPng(FOREGROUND_GLYPH_SVG, 1024, 'mobile-expo/assets/adaptive-icon.png');
}

async function writeAndroidLauncherAssets() {
  for (const target of androidLauncherTargets) {
    const base = `android/app/src/main/res/${target.folder}`;
    await renderPng(FULL_ICON_SVG, target.size, `${base}/ic_launcher.png`);
    await renderPng(FULL_ICON_SVG, target.size, `${base}/ic_launcher_round.png`);
  }

  for (const target of androidForegroundTargets) {
    const base = `android/app/src/main/res/${target.folder}`;
    await renderPng(FOREGROUND_GLYPH_SVG, target.size, `${base}/ic_launcher_foreground.png`);
  }
}

async function writeMacIcns() {
  if (process.platform !== 'darwin') {
    return;
  }

  const iconsetDir = path.join(ROOT, 'electron', 'assets', 'icon.iconset');
  await fs.rm(iconsetDir, { recursive: true, force: true });
  await fs.mkdir(iconsetDir, { recursive: true });

  const iconsetTargets = [
    { size: 16, name: 'icon_16x16.png' },
    { size: 32, name: 'icon_16x16@2x.png' },
    { size: 32, name: 'icon_32x32.png' },
    { size: 64, name: 'icon_32x32@2x.png' },
    { size: 128, name: 'icon_128x128.png' },
    { size: 256, name: 'icon_128x128@2x.png' },
    { size: 256, name: 'icon_256x256.png' },
    { size: 512, name: 'icon_256x256@2x.png' },
    { size: 512, name: 'icon_512x512.png' },
    { size: 1024, name: 'icon_512x512@2x.png' },
  ];

  for (const target of iconsetTargets) {
    await sharp(Buffer.from(FULL_ICON_SVG))
      .resize(target.size, target.size, { fit: 'contain' })
      .png()
      .toFile(path.join(iconsetDir, target.name));
  }

  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(ROOT, 'electron', 'assets', 'icon.icns')], {
    stdio: 'pipe',
  });

  await fs.rm(iconsetDir, { recursive: true, force: true });
}

async function main() {
  await writeSvgArtifacts();
  await writeFullIconAssets();
  await writeExpoAdaptiveIcon();
  await writeAndroidLauncherAssets();
  await writeMacIcns();

  console.log('Brand assets generated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
