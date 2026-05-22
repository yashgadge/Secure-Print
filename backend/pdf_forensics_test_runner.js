const path = require('path');

(async () => {
  const mod = require('./pdf_forensics');
  if (typeof mod.testEmbedForensicOverlay !== 'function') {
    console.error('testEmbedForensicOverlay not found in pdf_forensics.js');
    process.exit(1);
  }
  await mod.testEmbedForensicOverlay();
  console.log('testEmbedForensicOverlay: done');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
