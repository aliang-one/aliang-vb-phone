#!/usr/bin/env node
// Regenerate app launcher icons from assets/aliang-logo.svg.
//   - iOS  AppIcon.appiconset (every size listed in Contents.json)
//   - Android legacy ic_launcher / ic_launcher_round (48dp × densities, full icon)
//   - Android adaptive foreground ic_launcher_foreground (108dp × densities, logo only)
// Logo is composed on a dark (#0F1A14) background. Dev dep: @resvg/resvg-js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGO = fs.readFileSync(path.join(ROOT, 'assets/aliang-logo.svg'), 'utf8');
const inner = LOGO.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];

const BG = '#0F1A14';
// logo viewBox is 269×245; place() scales by s and centers it in a 1024 canvas.
const place = s => {
  const tx = 512 - (269 * s) / 2;
  const ty = 512 - (245 * s) / 2;
  return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s})">${inner}</g>`;
};

// Full icon (opaque): dark bg + logo at ~62%.
const fullMaster = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
<rect width="1024" height="1024" fill="${BG}"/>
${place(2.4)}
</svg>`;

// Adaptive foreground (transparent): logo alone in the safe zone (~52%).
const fgMaster = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
${place(2.0)}
</svg>`;

const render = (svg, px) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: px } }).render().asPng();

const write = (file, buf) => {
  fs.writeFileSync(file, buf);
  console.log('  ✓', path.relative(ROOT, file));
};

// 1. iOS AppIcon — rasterize the full icon at each size from Contents.json.
console.log('iOS AppIcon:');
const setDir = path.join(
  ROOT,
  'ios/AliangVibeCodingPhone/Images.xcassets/AppIcon.appiconset',
);
const cj = JSON.parse(fs.readFileSync(path.join(setDir, 'Contents.json'), 'utf8'));
for (const img of cj.images) {
  if (!img.filename) continue;
  const base = parseFloat(img.size); // "20x20" → 20, "83.5x83.5" → 83.5
  const scale = parseInt(img.scale, 10); // "2x" → 2
  write(path.join(setDir, img.filename), render(fullMaster, Math.round(base * scale)));
}

// 2. Android legacy launcher icons (48dp × densities) — full icon.
console.log('Android legacy ic_launcher / ic_launcher_round:');
for (const [d, px] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  const dir = path.join(ROOT, `android/app/src/main/res/mipmap-${d}`);
  write(path.join(dir, 'ic_launcher.png'), render(fullMaster, px));
  write(path.join(dir, 'ic_launcher_round.png'), render(fullMaster, px));
}

// 3. Android adaptive foreground (108dp × densities) — logo only, transparent.
console.log('Android adaptive foreground:');
for (const [d, px] of Object.entries({ mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 })) {
  const dir = path.join(ROOT, `android/app/src/main/res/mipmap-${d}`);
  write(path.join(dir, 'ic_launcher_foreground.png'), render(fgMaster, px));
}

// 4. Splash logo — logo only on transparent, larger (~74%), for the native
// launch screens (iOS LaunchScreen imageView + Android launch_screen drawable).
const splashMaster = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
${place(2.8)}
</svg>`;

console.log('iOS Logo.imageset (splash):');
const logoSet = path.join(ROOT, 'ios/AliangVibeCodingPhone/Images.xcassets/Logo.imageset');
fs.mkdirSync(logoSet, { recursive: true });
for (const [scale, px] of [['1x', 200], ['2x', 400], ['3x', 600]]) {
  write(path.join(logoSet, `logo-${scale}.png`), render(splashMaster, px));
}
fs.writeFileSync(
  path.join(logoSet, 'Contents.json'),
  JSON.stringify(
    {
      images: [
        { filename: 'logo-1x.png', idiom: 'universal', scale: '1x' },
        { filename: 'logo-2x.png', idiom: 'universal', scale: '2x' },
        { filename: 'logo-3x.png', idiom: 'universal', scale: '3x' },
      ],
      info: { author: 'xcode', version: 1 },
    },
    null,
    2,
  ) + '\n',
);
console.log('  ✓', path.relative(ROOT, path.join(logoSet, 'Contents.json')));

console.log('Android splash logo bitmap:');
const drawableXxxhdpi = path.join(ROOT, 'android/app/src/main/res/drawable-xxxhdpi');
fs.mkdirSync(drawableXxxhdpi, { recursive: true });
write(path.join(drawableXxxhdpi, 'splash_logo.png'), render(splashMaster, 432));

console.log('Done.');
