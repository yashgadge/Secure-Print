const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');



// ─── Constants ───────────────────────────────────────────────────────────────
const BAND_W      = 20;   // band height/width — wider for bigger symbols
const CELL        = 11;   // symbol cell size — large enough to survive scan blur
const CELL_GAP    = 14;   // centre-to-centre spacing — wide enough to never merge
const ANCHOR_ARM  = 16;   // L-bracket arm length
const ANCHOR_T    = 3.5;  // L-bracket stroke thickness
const MARK_COL    = rgb(0.08, 0.08, 0.08);  // near-black for symbols & anchors
const LINE_COL    = rgb(0.55, 0.55, 0.55);  // mid-grey for the thin border line
const SEP_COL     = rgb(0.35, 0.35, 0.35);  // group separator colour

// ─── Core payload — the minimum needed to identify leak center ────────────────
// Every single side encodes the SAME core: centerId|copyNumber|jobId|cs
// So even if 3 sides are cut off or blurred, 1 surviving side is enough.
function buildCoreString(p, cs) {
  // Short but unique — centerId is the most critical field
  return `${p.centerId}|${p.copyNumber}|${p.jobId}|${cs}`;
}

function buildPayloadString(p) {
  return [
    p.jobId, p.copyNumber, p.operatorId,
    p.centerId, p.printerId || 'NOPRN',
    p.batchId, p.timestamp || p.generatedAt || '', p.forensicId
  ].join('|');
}

function checksum8(str) {
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 8).toUpperCase();
}

// ─── Symbol alphabet — 4 solid vector shapes, full opacity ──────────────────
//  SHORT_BAR  ─  thin horizontal bar, vertically centred
//  LONG_BAR   ━  full-width thick horizontal bar, vertically centred
//  TRIANGLE   ▲  filled upward triangle (3 solid rects stacked)
//  SQUARE     ■  full solid square
//
// All shapes are solid filled rectangles only — no outlines, no transparency.
const SYM = { SHORT_BAR: 0, LONG_BAR: 1, TRIANGLE: 2, SQUARE: 3 };

function encodeToSymbols(str, count) {
  const hash = crypto.createHash('sha256').update(str).digest('hex');
  let hex = hash;
  while (hex.length < count * 2) hex += hash;
  const syms = [];
  for (let i = 0; i < hex.length && syms.length < count; i += 2) {
    const b = parseInt(hex.substr(i, 2), 16);
    syms.push((b >> 6) & 3);
    if (syms.length < count) syms.push((b >> 4) & 3);
    if (syms.length < count) syms.push((b >> 2) & 3);
    if (syms.length < count) syms.push(b & 3);
  }
  return syms.slice(0, count);
}

function drawSym(page, sym, x, y) {
  const s   = CELL;
  const col = MARK_COL;
  switch (sym) {
    case SYM.SHORT_BAR: { // ─  short thin bar, centred
      const bh = Math.round(s * 0.22);  // bar height ~2.4pt
      const bw = Math.round(s * 0.55);  // bar width  ~6pt
      const ox = Math.round((s - bw) / 2);
      const oy = Math.round((s - bh) / 2);
      page.drawRectangle({ x: x + ox, y: y + oy, width: bw, height: bh, color: col, borderWidth: 0 });
      break;
    }
    case SYM.LONG_BAR: { // ━  full-width thick bar, centred
      const bh = Math.round(s * 0.38);  // bar height ~4pt
      const oy = Math.round((s - bh) / 2);
      page.drawRectangle({ x, y: y + oy, width: s, height: bh, color: col, borderWidth: 0 });
      break;
    }
    case SYM.TRIANGLE: { // ▲  filled upward triangle via stacked rects
      // Row 0 (top): 1 unit wide centred; each row down adds 2 units
      const rows = Math.round(s * 0.72);  // number of pixel rows
      const rowH = s / rows;
      for (let r = 0; r < rows; r++) {
        const rowW = s * ((r + 1) / rows);  // widens toward base
        const rx   = x + (s - rowW) / 2;
        const ry   = y + (s - (r + 1) * rowH);  // top rows first
        page.drawRectangle({ x: rx, y: ry, width: rowW, height: rowH + 0.3, color: col, borderWidth: 0 });
      }
      break;
    }
    case SYM.SQUARE: { // ■  full solid square
      page.drawRectangle({ x, y, width: s, height: s, color: col, borderWidth: 0 });
      break;
    }
  }
}

// Separator: short vertical tick crossing the band centre — marks every 8 symbols
function drawHSep(page, x, bandY) {
  // Tick spans 70% of cell height, centred on band
  const tickH = Math.round(CELL * 0.7);
  const oy    = Math.round((CELL - tickH) / 2);
  page.drawRectangle({ x: x - 0.5, y: bandY + oy, width: 1.5, height: tickH, color: SEP_COL, borderWidth: 0 });
}
function drawVSep(page, bandX, y) {
  // Tick spans 70% of cell width, centred on band
  const tickW = Math.round(CELL * 0.7);
  const ox    = Math.round((CELL - tickW) / 2);
  page.drawRectangle({ x: bandX + ox, y: y - 0.5, width: tickW, height: 1.5, color: SEP_COL, borderWidth: 0 });
}

// ─── Corner anchor: bold L-bracket, orientation-specific ────────────────────
// Large enough (14pt arms) to survive crop and blur.
// Each corner has a unique orientation so you always know which corner survived.
function drawCornerAnchor(page, ox, oy, corner) {
  const a = ANCHOR_ARM;
  const t = ANCHOR_T;
  const c = MARK_COL;
  // ox,oy = outer corner point of the L
  switch (corner) {
    case 'tl': // top-left: arms go right and down
      page.drawLine({ start: { x: ox, y: oy }, end: { x: ox + a, y: oy },     thickness: t, color: c });
      page.drawLine({ start: { x: ox, y: oy }, end: { x: ox,     y: oy - a }, thickness: t, color: c });
      break;
    case 'tr': // top-right: arms go left and down
      page.drawLine({ start: { x: ox, y: oy }, end: { x: ox - a, y: oy },     thickness: t, color: c });
      page.drawLine({ start: { x: ox, y: oy }, end: { x: ox,     y: oy - a }, thickness: t, color: c });
      break;
    case 'bl': // bottom-left: arms go right and up
      page.drawLine({ start: { x: ox, y: oy }, end: { x: ox + a, y: oy },     thickness: t, color: c });
      page.drawLine({ start: { x: ox, y: oy }, end: { x: ox,     y: oy + a }, thickness: t, color: c });
      break;
    case 'br': // bottom-right: arms go left and up
      page.drawLine({ start: { x: ox, y: oy }, end: { x: ox - a, y: oy },     thickness: t, color: c });
      page.drawLine({ start: { x: ox, y: oy }, end: { x: ox,     y: oy + a }, thickness: t, color: c });
      break;
  }
}

// ─── Draw horizontal symbol band ─────────────────────────────────────────────
function drawHBand(page, symbols, startX, endX, bandY) {
  let x = startX + 2;
  for (let i = 0; i < symbols.length; i++) {
    if (x + CELL_GAP > endX - 2) break;
    if (i > 0 && i % 8 === 0) { drawHSep(page, x, bandY); x += 4; }
    if (x + CELL_GAP > endX - 2) break;
    drawSym(page, symbols[i], x, bandY);
    x += CELL_GAP;
  }
}

// ─── Draw vertical symbol band ───────────────────────────────────────────────
function drawVBand(page, symbols, bandX, startY, endY) {
  let y = startY + 2;
  for (let i = 0; i < symbols.length; i++) {
    if (y + CELL_GAP > endY - 2) break;
    if (i > 0 && i % 8 === 0) { drawVSep(page, bandX, y); y += 4; }
    if (y + CELL_GAP > endY - 2) break;
    drawSym(page, symbols[i], bandX, y);
    y += CELL_GAP;
  }
}

// ─── LAYER 1: PDF metadata ────────────────────────────────────────────────────
function embedMetadata(pdfDoc, payload, payloadStr, cs) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  pdfDoc.setKeywords([`SPLFID:${encoded}`]);
  pdfDoc.setSubject(`SPL|J:${payload.jobId}|C:${payload.copyNumber}|O:${payload.operatorId}|CTR:${payload.centerId}|B:${payload.batchId}|CS:${cs}`);
  pdfDoc.setCreator(`SecurePrintLedger|${payload.forensicId}|${cs}`);
  pdfDoc.setProducer(`SPL-v2|${payload.batchId}|${payload.copyNumber}`);
  pdfDoc.setAuthor(`SPLOP:${payload.operatorId}|SPLCTR:${payload.centerId}`);
}

// ─── LAYER 2 + 3 + 4: Border line + anchors + symbol bands + readable ID ──────
async function embedBorderLayer(page, payload, payloadStr, cs, font) {
  const { width, height } = page.getSize();

  const OUTER = 6;
  const INNER = OUTER + BAND_W;

  // ── Thin single border line (light grey) ──
  const lw = 0.4;
  page.drawLine({ start: { x: OUTER, y: height - OUTER }, end: { x: width - OUTER, y: height - OUTER }, thickness: lw, color: LINE_COL });
  page.drawLine({ start: { x: OUTER, y: OUTER },          end: { x: width - OUTER, y: OUTER },          thickness: lw, color: LINE_COL });
  page.drawLine({ start: { x: OUTER, y: OUTER },          end: { x: OUTER,         y: height - OUTER }, thickness: lw, color: LINE_COL });
  page.drawLine({ start: { x: width - OUTER, y: OUTER },  end: { x: width - OUTER, y: height - OUTER }, thickness: lw, color: LINE_COL });

  // ── L-bracket anchors ──
  const ap = OUTER + 2;
  drawCornerAnchor(page, ap,             height - ap,             'tl');
  drawCornerAnchor(page, width - ap,     height - ap,             'tr');
  drawCornerAnchor(page, ap,             ap,                      'bl');
  drawCornerAnchor(page, width - ap,     ap,                      'br');

  // ── Symbol bands — all 4 sides, same core string ──
  const coreStr = buildCoreString(payload, cs);

  const symY_top    = height - OUTER - BAND_W / 2 - CELL / 2;
  const symY_bottom = OUTER  + BAND_W / 2 - CELL / 2;
  const symX_left   = OUTER  + BAND_W / 2 - CELL / 2;
  const symX_right  = width  - OUTER - BAND_W / 2 - CELL / 2;

  const hStart = OUTER + ANCHOR_ARM + 4;
  const hEnd   = width  - OUTER - ANCHOR_ARM - 4;
  const vStart = OUTER  + ANCHOR_ARM + 4;
  const vEnd   = height - OUTER - ANCHOR_ARM - 4;

  const hCount = Math.floor((hEnd - hStart) / CELL_GAP);
  const vCount = Math.floor((vEnd - vStart) / CELL_GAP);

  drawHBand(page, encodeToSymbols(coreStr, hCount), hStart, hEnd, symY_top);
  drawHBand(page, encodeToSymbols(coreStr, hCount), hStart, hEnd, symY_bottom);
  drawVBand(page, encodeToSymbols(coreStr, vCount), symX_left,  vStart, vEnd);
  drawVBand(page, encodeToSymbols(coreStr, vCount), symX_right, vStart, vEnd);

  if (!font) return;

  // ── LAYER 4a: Micro-text in bottom band (machine-readable) ──
  const microText = `CTR:${payload.centerId} CPY:${payload.copyNumber} JOB:${payload.jobId} ${cs}`;
  page.drawText(microText, { x: hStart, y: OUTER + 2, size: 5, font, color: rgb(0.2, 0.2, 0.2), maxWidth: hEnd - hStart });

  // ── LAYER 4b: Human-readable copy ID printed in left margin (vertical) ──
  const marginLabel = `SPL CTR${payload.centerId} C${payload.copyNumber} ${cs}`;
  page.drawText(marginLabel, {
    x: OUTER + 1,
    y: vStart,
    size: 7,
    font,
    color: rgb(0.1, 0.1, 0.1),
    rotate: { type: 'degrees', angle: 90 }
  });

  // ── LAYER 4c: Visible stamp in bottom-right corner — survives photos/crops ──
  // Large enough to OCR from a phone photo. Key fields only.
  const stampText = `SPL CTR${payload.centerId} C${payload.copyNumber} ${cs}`;
  const stampX = width - OUTER - 120;
  const stampY = OUTER + 28;
  page.drawRectangle({ x: stampX - 4, y: stampY - 4, width: 124, height: 22, color: rgb(0.95, 0.95, 0.95), borderWidth: 0 });
  page.drawText(stampText, { x: stampX, y: stampY, size: 9, font, color: rgb(0.05, 0.05, 0.05) });
}

// ─── Build placeholder PDF ────────────────────────────────────────────────────
async function buildPlaceholderPDF(payload) {
  const doc   = await PDFDocument.create();
  const page  = doc.addPage([595, 842]);
  const font  = await doc.embedFont(StandardFonts.Helvetica);
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: rgb(0.06, 0.10, 0.28) });
  page.drawText('SECURE DOCUMENT', { x: 40, y: height - 38, size: 20, font: fontB, color: rgb(1, 1, 1) });
  page.drawText('SecurePrint Ledger — Forensic Copy', { x: 40, y: height - 56, size: 9, font, color: rgb(0.6, 0.75, 1) });

  page.drawRectangle({ x: width - 130, y: height - 58, width: 90, height: 26, color: rgb(0, 0.7, 0.85), borderWidth: 0 });
  page.drawText(`COPY  #${payload.copyNumber}`, { x: width - 122, y: height - 48, size: 11, font: fontB, color: rgb(1, 1, 1) });

  page.drawLine({ start: { x: 40, y: height - 90 }, end: { x: width - 40, y: height - 90 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });

  const infoY = height - 120;
  const rows = [
    ['Job Reference',   payload.jobRef   || payload.jobId],
    ['Batch Reference', payload.batchRef || payload.batchId],
    ['Copy Number',     `${payload.copyNumber} of batch`],
    ['Operator ID',     payload.operatorId],
    ['Print Center',    payload.centerName || String(payload.centerId)],
    ['Forensic ID',     payload.forensicId],
    ['Generated At',    payload.generatedAt || payload.timestamp],
  ];
  rows.forEach(([label, value], i) => {
    const y = infoY - i * 22;
    page.drawText(label + ':', { x: 50, y, size: 9, font, color: rgb(0.45, 0.45, 0.45) });
    page.drawText(String(value || '—'), { x: 200, y, size: 9, font: fontB, color: rgb(0.1, 0.1, 0.1) });
  });

  page.drawLine({ start: { x: 40, y: infoY - rows.length * 22 - 10 }, end: { x: width - 40, y: infoY - rows.length * 22 - 10 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });

  const bodyY = infoY - rows.length * 22 - 30;
  page.drawText('DOCUMENT CONTENT', { x: 50, y: bodyY, size: 11, font: fontB, color: rgb(0.2, 0.2, 0.2) });
  const lorem = 'This document has been issued through the SecurePrint Ledger system and contains embedded forensic identifiers. Each copy carries a unique encoded signature in the border bands and document metadata. Unauthorized reproduction, distribution, or disclosure of this document is strictly prohibited. Any leaked copy can be traced back to its origin using the forensic recovery system.';
  const words = lorem.split(' ');
  let line = '', lineY = bodyY - 20;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (test.length > 85) {
      page.drawText(line, { x: 50, y: lineY, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
      lineY -= 14;
      line = word;
    } else { line = test; }
  }
  if (line) page.drawText(line, { x: 50, y: lineY, size: 9, font, color: rgb(0.3, 0.3, 0.3) });

  const noticeY = lineY - 40;
  page.drawRectangle({ x: 40, y: noticeY - 30, width: width - 80, height: 44, color: rgb(1, 0.97, 0.88), borderWidth: 1, borderColor: rgb(0.9, 0.7, 0.2) });
  page.drawText('! SECURITY NOTICE', { x: 52, y: noticeY + 4, size: 9, font: fontB, color: rgb(0.6, 0.4, 0) });
  page.drawText('This copy is uniquely encoded. Forensic markers are embedded in the border bands and document metadata.', { x: 52, y: noticeY - 12, size: 8, font, color: rgb(0.5, 0.35, 0) });

  page.drawLine({ start: { x: 40, y: 55 }, end: { x: width - 40, y: 55 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  page.drawText(`SecurePrint Ledger  |  Forensic Copy ${payload.copyNumber}  |  ${payload.forensicId}`, { x: 50, y: 42, size: 7, font, color: rgb(0.55, 0.55, 0.55) });
  page.drawText(`Confidential — Unauthorized use prohibited`, { x: 50, y: 32, size: 7, font, color: rgb(0.55, 0.55, 0.55) });

  return doc.save();
}

// ─── Main embed function ──────────────────────────────────────────────────────
async function embedForensicMarkers(sourcePath, outputPath, payload) {
  payload.timestamp = payload.generatedAt || new Date().toISOString();

  const payloadStr = buildPayloadString(payload);
  const cs = checksum8(payloadStr);

  let pdfDoc;
  let usedPlaceholder = false;

  try {
    const raw = fs.readFileSync(sourcePath);
    if (raw.length < 10 || !raw.slice(0, 5).toString().startsWith('%PDF')) throw new Error('Not a valid PDF');
    pdfDoc = await PDFDocument.load(raw, { ignoreEncryption: true });
  } catch (loadErr) {
    console.log(`[forensics] Source PDF not usable (${loadErr.message}), using placeholder`);
    const placeholderBytes = await buildPlaceholderPDF(payload);
    pdfDoc = await PDFDocument.load(placeholderBytes, { ignoreEncryption: true });
    usedPlaceholder = true;
  }

  embedMetadata(pdfDoc, payload, payloadStr, cs);

  // Embed font once for micro-text layer
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Restored full unique border symbol encoding on every page
  for (const page of pdfDoc.getPages()) {
    await embedBorderLayer(page, payload, payloadStr, cs, font);
  }

  const outBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, outBytes);

  return {
    forensicId: payload.forensicId,
    checksum: cs,
    proofHash: crypto.createHash('sha256').update(outBytes).digest('hex'),
    layers: ['metadata', 'border_anchors', 'symbol_bands_micro_text'],
    usedPlaceholder
  };
}



// ─── Perspective correction helpers ─────────────────────────────────────────
// Finds the largest near-rectangular contour in a greyscale Jimp image
// and returns the four corner points {tl, tr, bl, br} in image coordinates.
// If no reliable quad is found, returns null.
function findPageCorners(jimpImg, W, H) {
  // Build a binary edge map: dark pixels near the page boundary
  // Strategy: scan inward from each edge to find the first dark column/row
  const THRESH = 80;  // pixel brightness below this = dark
  const SCAN   = Math.round(Math.min(W, H) * 0.15); // scan up to 15% inward

  function brightness(img, x, y) {
    const idx = (y * W + x) * 4;
    return img.bitmap.data[idx]; // R channel (greyscale)
  }

  // Find first dark row from top
  let top = 0;
  outer: for (let y = 0; y < SCAN; y++) {
    for (let x = Math.round(W * 0.1); x < Math.round(W * 0.9); x++) {
      if (brightness(jimpImg, x, y) < THRESH) { top = y; break outer; }
    }
  }
  // Find first dark row from bottom
  let bottom = H - 1;
  outer: for (let y = H - 1; y > H - 1 - SCAN; y--) {
    for (let x = Math.round(W * 0.1); x < Math.round(W * 0.9); x++) {
      if (brightness(jimpImg, x, y) < THRESH) { bottom = y; break outer; }
    }
  }
  // Find first dark col from left
  let left = 0;
  outer: for (let x = 0; x < SCAN; x++) {
    for (let y = Math.round(H * 0.1); y < Math.round(H * 0.9); y++) {
      if (brightness(jimpImg, x, y) < THRESH) { left = x; break outer; }
    }
  }
  // Find first dark col from right
  let right = W - 1;
  outer: for (let x = W - 1; x > W - 1 - SCAN; x--) {
    for (let y = Math.round(H * 0.1); y < Math.round(H * 0.9); y++) {
      if (brightness(jimpImg, x, y) < THRESH) { right = x; break outer; }
    }
  }

  // Reject if the detected quad is too small (< 40% of image)
  if ((right - left) < W * 0.4 || (bottom - top) < H * 0.4) return null;

  return { tl: { x: left, y: top }, tr: { x: right, y: top },
           bl: { x: left, y: bottom }, br: { x: right, y: bottom } };
}

// Bilinear perspective warp: map src quad → dst rectangle
// Returns a new Jimp image of size (dstW x dstH)
async function perspectiveCorrect(Jimp, srcImg, corners, dstW, dstH) {
  const { tl, tr, bl, br } = corners;

  // For each destination pixel, compute source coordinate via inverse bilinear
  // Using simple homography approximation (sufficient for near-rectangular pages)
  function srcCoord(dx, dy) {
    const tx = dx / dstW, ty = dy / dstH;
    // Bilinear interpolation of the four corners
    const sx = (1-tx)*(1-ty)*tl.x + tx*(1-ty)*tr.x + (1-tx)*ty*bl.x + tx*ty*br.x;
    const sy = (1-tx)*(1-ty)*tl.y + tx*(1-ty)*tr.y + (1-tx)*ty*bl.y + tx*ty*br.y;
    return { sx: Math.round(sx), sy: Math.round(sy) };
  }

  const srcW = typeof srcImg.getWidth  === 'function' ? srcImg.getWidth()  : srcImg.width;
  const srcH = typeof srcImg.getHeight === 'function' ? srcImg.getHeight() : srcImg.height;

  // Create output image
  const out = new Jimp({ width: dstW, height: dstH, color: 0xFFFFFFFF });

  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const { sx, sy } = srcCoord(dx, dy);
      if (sx < 0 || sx >= srcW || sy < 0 || sy >= srcH) continue;
      const srcIdx = (sy * srcW + sx) * 4;
      const dstIdx = (dy * dstW + dx) * 4;
      out.bitmap.data[dstIdx]     = srcImg.bitmap.data[srcIdx];
      out.bitmap.data[dstIdx + 1] = srcImg.bitmap.data[srcIdx + 1];
      out.bitmap.data[dstIdx + 2] = srcImg.bitmap.data[srcIdx + 2];
      out.bitmap.data[dstIdx + 3] = srcImg.bitmap.data[srcIdx + 3];
    }
  }
  return out;
}

// ─── Image recovery — OCR + pixel scan, works on screenshots/blurry/partial ──
async function recoverFromImage(filePath, db) {
  let Jimp;
  try { Jimp = require('jimp').Jimp; } catch (e) {
    console.log('[forensics] jimp not available:', e.message);
    return null;
  }

  let img;
  try { img = await Jimp.read(filePath); } catch (e) {
    console.log('[forensics] jimp could not read image:', e.message);
    return null;
  }

  // Jimp v1 uses .width/.height; v0 uses .getWidth()/.getHeight()
  const W = typeof img.getWidth === 'function' ? img.getWidth() : img.width;
  const H = typeof img.getHeight === 'function' ? img.getHeight() : img.height;
  if (W < 30 || H < 30) return null;

  // ── Jimp v0/v1 compat helpers ──────────────────────────────────────────────
  function jimpW(j) { return typeof j.getWidth  === 'function' ? j.getWidth()  : j.width;  }
  function jimpH(j) { return typeof j.getHeight === 'function' ? j.getHeight() : j.height; }
  async function jimpBuf(j) {
    if (typeof j.getBufferAsync === 'function') return j.getBufferAsync('image/png');
    return j.getBuffer('image/png');
  }
  function jimpClone(j) { return typeof j.clone === 'function' ? j.clone() : Jimp.fromBitmap(j.bitmap); }
  function jimpCrop(j, x, y, w, h) {
    const c = jimpClone(j);
    try {
      const res = c.crop({ x, y, w, h });
      return res || c;
    } catch (e) {
      return c.crop(x, y, w, h);
    }
  }
  function jimpRotate(j, deg) { return typeof j.rotate === 'function' ? j.rotate(deg) : j.rotate(deg); }
  function jimpGreyscale(j) { return typeof j.greyscale === 'function' ? j.greyscale() : j.grayscale(); }
  function jimpPixelBrightness(j, x, y) {
    if (typeof j.getPixelColor === 'function') {
      const hex = j.getPixelColor(x, y);
      return (hex >>> 24) & 0xff;
    }
    // Jimp v1: bitmap.data is RGBA buffer
    const idx = (y * jimpW(j) + x) * 4;
    return j.bitmap.data[idx]; // R channel (greyscale after greyscale())
  }

  // ── Step 1: Perspective correction ──────────────────────────────────────────
  // Try to detect page boundary and flatten perspective before any strip work
  let workImg = img;
  try {
    const grey = jimpClone(img);
    jimpGreyscale(grey);
    const corners = findPageCorners(grey, W, H);
    if (corners) {
      const cW = corners.tr.x - corners.tl.x;
      const cH = corners.bl.y - corners.tl.y;
      if (cW > W * 0.4 && cH > H * 0.4) {
        workImg = await perspectiveCorrect(Jimp, img, corners, cW, cH);
        console.log(`[forensics] perspective corrected: ${W}x${H} → ${cW}x${cH}`);
      }
    }
  } catch (e) {
    console.log('[forensics] perspective correction skipped:', e.message);
    workImg = img;
  }

  // ── STRATEGY 1: OCR — extract SPL label / micro-text directly ──────────────
  async function ocrImage(jimpImg) {
    let Tesseract;
    try { Tesseract = require('tesseract.js'); } catch { return ''; }
    try {
      const enhanced = jimpClone(jimpImg);
      jimpGreyscale(enhanced);
      if (typeof enhanced.normalize === 'function') enhanced.normalize();
      if (typeof enhanced.contrast  === 'function') enhanced.contrast(0.4);

      const buf = await jimpBuf(enhanced);
      const { data: { text } } = await Tesseract.recognize(buf, 'eng', {
        logger: () => {},
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789|: .\n',
      });
      return text || '';
    } catch (e) {
      console.log('[forensics] OCR error:', e.message);
      return '';
    }
  }

  async function ocrStrip(jimpImg, side) {
    const w = jimpW(jimpImg), h = jimpH(jimpImg);
    // Use 18% for border strips — captures the stamp + margin label reliably
    const stripH = Math.max(60, Math.round(h * 0.18));
    const stripW = Math.max(60, Math.round(w * 0.18));
    let crop;
    if (side === 'top')    crop = jimpCrop(jimpImg, 0, 0, w, stripH);
    if (side === 'bottom') crop = jimpCrop(jimpImg, 0, h - stripH, w, stripH);
    if (side === 'left')   crop = jimpRotate(jimpCrop(jimpImg, 0, 0, stripW, h), 90);
    if (side === 'right')  crop = jimpRotate(jimpCrop(jimpImg, w - stripW, 0, stripW, h), -90);
    // Upscale small strips so Tesseract has enough pixels to work with
    const cw = jimpW(crop), ch = jimpH(crop);
    if (cw < 400 || ch < 80) {
      const scale = Math.max(2, Math.ceil(400 / cw));
      if (typeof crop.scale === 'function') {
        try {
          crop.scale(scale);
        } catch (e) {
          if (typeof crop.resize === 'function') {
            try { crop.resize({ w: cw * scale, h: ch * scale }); } catch (err) { crop.resize(cw * scale, ch * scale); }
          }
        }
      } else if (typeof crop.resize === 'function') {
        try { crop.resize({ w: cw * scale, h: ch * scale }); } catch (err) { crop.resize(cw * scale, ch * scale); }
      }
    }
    return ocrImage(crop);
  }

  // Majority vote: given an array of parsed OCR results, return the one
  // that appears most often (by centerId+copyNumber key), or the first non-null.
  function majorityVote(results) {
    const valid = results.filter(Boolean);
    if (valid.length === 0) return null;
    const counts = {};
    for (const r of valid) {
      const key = `${r.centerId || ''}|${r.copyNumber || ''}|${r.checksum || ''}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    let best = null, bestCount = 0;
    for (const r of valid) {
      const key = `${r.centerId || ''}|${r.copyNumber || ''}|${r.checksum || ''}`;
      if (counts[key] > bestCount) { bestCount = counts[key]; best = r; }
    }
    return best;
  }

  // Parse OCR text for SPL markers
  function parseOcrText(text) {
    if (!text) return null;
    const t = text.replace(/\s+/g, ' ').toUpperCase();

    // Pattern 1: SPL CTR{centerId} C{copyNumber} {checksum8}  (margin label + stamp)
    const m1 = t.match(/SPL[\s:]*CTR[\s:]*([\w]+)[\s:]+C[\s:]*([\w]+)[\s:]+([A-F0-9]{8})/i);
    if (m1) return { centerId: m1[1], copyNumber: m1[2], checksum: m1[3], source: 'ocr_margin_label' };

    // Pattern 1b: SPL CTR{n} C{n} — checksum may have spaces inserted by OCR
    const m1b = t.match(/SPL[\s:]*CTR[\s:]*([\w]+)[\s:]+C[\s:]*([\w]+)[\s:]+([A-F0-9 ]{8,12})/);
    if (m1b) {
      const cs = m1b[3].replace(/\s/g, '');
      if (cs.length === 8) return { centerId: m1b[1], copyNumber: m1b[2], checksum: cs, source: 'ocr_margin_label' };
    }

    // Pattern 2: CTR:{centerId} CPY:{copyNumber} JOB:{jobId} {checksum8} (micro-text)
    const m2 = t.match(/CTR[:\s]+([\w]+)[\s]+CPY[:\s]+([\w]+)[\s]+JOB[:\s]+([\w]+)[\s]+([A-F0-9]{8})/i);
    if (m2) return { centerId: m2[1], copyNumber: m2[2], jobId: m2[3], checksum: m2[4], source: 'ocr_micro_text' };

    // Pattern 3: partial — just CTR and CPY
    const m3 = t.match(/CTR[:\s]+([\w]+)[\s]+CPY[:\s]+([\w]+)/i);
    if (m3) return { centerId: m3[1], copyNumber: m3[2], source: 'ocr_partial' };

    // Pattern 4: SPL|J:{jobId}|C:{copy}|O:{op}|CTR:{ctr} (subject line visible)
    const m4 = t.match(/SPL[|\s]+J[:\s]*([\w]+)[|\s]+C[:\s]*([\w]+)[|\s]+O[:\s]*([\w]+)[|\s]+CTR[:\s]*([\w]+)/i);
    if (m4) return { jobId: m4[1], copyNumber: m4[2], operatorId: m4[3], centerId: m4[4], source: 'ocr_subject' };

    // Pattern 5: just a forensicId hex string (24 uppercase hex chars)
    const m5 = t.match(/\b([A-F0-9]{24})\b/);
    if (m5) return { forensicId: m5[1], source: 'ocr_forensic_id' };

    return null;
  }

  // Run OCR on full image + all 4 border strips in parallel (use perspective-corrected image)
  const [fullText, topText, bottomText, leftText, rightText] = await Promise.all([
    ocrImage(workImg),
    ocrStrip(workImg, 'top'),
    ocrStrip(workImg, 'bottom'),
    ocrStrip(workImg, 'left'),
    ocrStrip(workImg, 'right'),
  ]);

  const allTexts = [fullText, topText, bottomText, leftText, rightText];
  console.log('[forensics] OCR texts:', allTexts.map(t => t.substring(0, 80)));

  // Parse all sides and apply majority vote
  const parsedResults = allTexts.map(parseOcrText);
  const ocrResult = majorityVote(parsedResults);
  if (ocrResult) console.log('[forensics] majority vote result:', ocrResult);

  if (ocrResult && db) {
    console.log('[forensics] OCR parsed:', ocrResult);
    // Try to match against DB using extracted fields
    let row = null;

    if (ocrResult.forensicId) {
      row = db.prepare(`SELECT fc.*, pc.copy_number FROM forensic_copies fc LEFT JOIN print_copies pc ON fc.copy_id = pc.id WHERE fc.forensic_payload LIKE ?`)
        .get(`%${ocrResult.forensicId}%`);
    }
    if (!row && ocrResult.jobId && ocrResult.copyNumber) {
      row = db.prepare(`SELECT fc.*, pc.copy_number FROM forensic_copies fc LEFT JOIN print_copies pc ON fc.copy_id = pc.id WHERE fc.job_id = ? AND pc.copy_number = ?`)
        .get(ocrResult.jobId, ocrResult.copyNumber);
    }
    if (!row && ocrResult.centerId && ocrResult.copyNumber) {
      row = db.prepare(`SELECT fc.*, pc.copy_number FROM forensic_copies fc LEFT JOIN print_copies pc ON fc.copy_id = pc.id JOIN print_jobs pj ON fc.job_id = pj.id WHERE pj.center_id = ? AND pc.copy_number = ? ORDER BY fc.id DESC LIMIT 1`)
        .get(ocrResult.centerId, ocrResult.copyNumber);
    }
    if (!row && ocrResult.centerId) {
      row = db.prepare(`SELECT fc.*, pc.copy_number FROM forensic_copies fc LEFT JOIN print_copies pc ON fc.copy_id = pc.id JOIN print_jobs pj ON fc.job_id = pj.id WHERE pj.center_id = ? ORDER BY fc.id DESC LIMIT 1`)
        .get(ocrResult.centerId);
    }

    if (row) {
      let stored;
      try { stored = JSON.parse(row.forensic_payload); } catch { stored = {}; }
      const payload = { ...stored, ...ocrResult, copyNumber: stored.copyNumber ?? row.copy_number };
      const confidence = ocrResult.source === 'ocr_margin_label' ? 0.93
        : ocrResult.source === 'ocr_micro_text' ? 0.91
        : ocrResult.source === 'ocr_subject' ? 0.88
        : ocrResult.source === 'ocr_partial' ? 0.72
        : 0.65;
      console.log(`[forensics] OCR match found via ${ocrResult.source}, confidence ${confidence}`);
      return {
        found: true, payload, forensicId: payload.forensicId || null,
        recoveryLayer: 'image_ocr',
        confidence,
        _matchedJobId: row.job_id, _matchedOperatorId: row.operator_id,
        _matchedCenterId: row.center_id, _matchedCopyId: row.copy_id
      };
    }
  }

  // ── STRATEGY 2: Shape-sequence decoder ────────────────────────────────────
  // Scan the border band, classify each symbol cell as 0/1/2/3, compare the
  // decoded sequence against every DB copy's expected sequence.
  if (!db) return null;

  const proc = jimpClone(workImg);
  jimpGreyscale(proc);
  if (typeof proc.normalize === 'function') proc.normalize();
  const PW = jimpW(proc), PH = jimpH(proc);

  function px(x, y) {
    return jimpPixelBrightness(proc,
      Math.max(0, Math.min(PW - 1, x)),
      Math.max(0, Math.min(PH - 1, y))
    );
  }

  // ── Classify a cell by its 3×3 zone darkness profile ──
  // The PDF draws symbols in a CELL×CELL square. After rasterisation the shapes
  // have these distinguishing features (in image coords, y=0 at top):
  //   SHORT_BAR (0): small dark blob only in centre — low overall darkness
  //   LONG_BAR  (1): dark band across full width in the middle row
  //   TRIANGLE  (2): dark region wider at BOTTOM than top (PDF y-axis flipped
  //                  when rasterised: PDF "top" = image bottom)
  //   SQUARE    (3): uniformly dark across the whole cell
  function classifyCell(getPixel, cw, ch) {
    if (cw < 2 || ch < 2) return 0;
    const zW = cw / 3, zH = ch / 3;
    function zone(col, row) {
      let dark = 0, total = 0;
      const x0 = Math.round(col * zW),       x1 = Math.min(cw - 1, Math.round((col+1)*zW) - 1);
      const y0 = Math.round(row * zH),       y1 = Math.min(ch - 1, Math.round((row+1)*zH) - 1);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) { if (getPixel(x, y) < 140) dark++; total++; }
      return total > 0 ? dark / total : 0;
    }
    const top = (zone(0,0)+zone(1,0)+zone(2,0))/3;
    const mid = (zone(0,1)+zone(1,1)+zone(2,1))/3;
    const bot = (zone(0,2)+zone(1,2)+zone(2,2))/3;
    const ctrCol = (zone(1,0)+zone(1,1)+zone(1,2))/3;
    const overall = (top+mid+bot)/3;

    if (overall > 0.50)                              return 3; // SQUARE
    if (bot > top + 0.18 && bot > 0.25)             return 2; // TRIANGLE
    if (mid > 0.30 && mid > top+0.12 && mid > bot+0.12) return 1; // LONG_BAR
    if (ctrCol > 0.18 && overall < 0.28)            return 0; // SHORT_BAR
    if (overall > 0.35) return 3;
    if (mid > 0.20)     return 1;
    return 0;
  }

  // ── Scan a horizontal strip and return the symbol sequence ──
  // stripY0/stripY1: pixel rows bounding the band.
  // Scans left→right, samples every gapPx pixels, classifies each slot.
  function scanHStrip(stripY0, stripY1, xStart, xEnd) {
    const ch = stripY1 - stripY0 + 1;
    if (ch < 2) return [];
    // Estimate cell width from the known PDF geometry scaled to image pixels
    // PDF page width = 595pt, CELL_GAP = 14pt → ratio = PW/595
    const scale  = PW / 595;
    const gapPx  = Math.max(2, Math.round(CELL_GAP * scale));
    const cellPx = Math.max(2, Math.round(CELL * scale));
    const syms = [];
    for (let x = xStart; x + cellPx <= xEnd; x += gapPx) {
      syms.push(classifyCell(
        (dx, dy) => px(x + dx, stripY0 + dy),
        cellPx, ch
      ));
      if (syms.length >= 80) break;
    }
    return syms;
  }

  // ── Scan a vertical strip and return the symbol sequence ──
  function scanVStrip(stripX0, stripX1, yStart, yEnd) {
    const cw = stripX1 - stripX0 + 1;
    if (cw < 2) return [];
    const scale  = PH / 842;
    const gapPx  = Math.max(2, Math.round(CELL_GAP * scale));
    const cellPx = Math.max(2, Math.round(CELL * scale));
    const syms = [];
    for (let y = yStart; y + cellPx <= yEnd; y += gapPx) {
      syms.push(classifyCell(
        (dx, dy) => px(stripX0 + dx, y + dy),
        cw, cellPx
      ));
      if (syms.length >= 80) break;
    }
    return syms;
  }

  // ── Locate the border band in pixel coordinates ──
  // The band sits at OUTER..OUTER+BAND_W from each edge in PDF points.
  // Scale to image pixels. Try a range of offsets to handle crops/scale.
  const scaleX = PW / 595, scaleY = PH / 842;
  // Band thickness in pixels
  const bandPxH = Math.max(4, Math.round(BAND_W * scaleY));
  const bandPxW = Math.max(4, Math.round(BAND_W * scaleX));
  // Anchor skip in pixels (symbols start after the L-bracket)
  const anchorPx = Math.round((ANCHOR_ARM + 4) * scaleX);

  // Try several offsets from the edge (handles partial crops, scale errors)
  const edgeOffsets = [0, 0.01, 0.02, 0.03, 0.05];

  const strips = {
    top:    edgeOffsets.map(f => {
      const y0 = Math.round(PH * f);
      return scanHStrip(y0, y0 + bandPxH, anchorPx, PW - anchorPx);
    }),
    bottom: edgeOffsets.map(f => {
      const y1 = PH - 1 - Math.round(PH * f);
      return scanHStrip(Math.max(0, y1 - bandPxH), y1, anchorPx, PW - anchorPx);
    }),
    left:   edgeOffsets.map(f => {
      const x0 = Math.round(PW * f);
      return scanVStrip(x0, x0 + bandPxW, anchorPx, PH - anchorPx);
    }),
    right:  edgeOffsets.map(f => {
      const x1 = PW - 1 - Math.round(PW * f);
      return scanVStrip(Math.max(0, x1 - bandPxW), x1, anchorPx, PH - anchorPx);
    }),
  };

  // Log strip lengths and first few symbols for diagnostics
  for (const [side, sideList] of Object.entries(strips)) {
    const best = sideList.reduce((a, b) => a.length > b.length ? a : b, []);
    console.log(`[forensics] ${side} strip: ${best.length} syms, first10=[${best.slice(0,10).join(',')}]`);
  }

  // ── Sequence similarity (4-level exact match) ──
  function seqSim(observed, expected) {
    const n = Math.min(observed.length, expected.length);
    if (n < 4) return 0;
    let match = 0;
    for (let i = 0; i < n; i++) if (observed[i] === expected[i]) match++;
    return match / n;
  }

  const copies = db.prepare(`
    SELECT fc.forensic_payload, fc.job_id, fc.operator_id, fc.center_id, fc.copy_id,
           pc.copy_number
    FROM forensic_copies fc
    LEFT JOIN print_copies pc ON fc.copy_id = pc.id
    WHERE fc.forensic_payload IS NOT NULL
  `).all();

  if (copies.length === 0) { console.log('[forensics] no copies in DB'); return null; }
  console.log(`[forensics] comparing against ${copies.length} copies`);

  let bestScore = 0, bestRow = null, bestPayload = null;

  for (const row of copies) {
    let stored;
    try { stored = JSON.parse(row.forensic_payload); } catch { continue; }
    const p = { ...stored, copyNumber: stored.copyNumber ?? row.copy_number };
    if (!p.timestamp && p.generatedAt) p.timestamp = p.generatedAt;
    const cs   = checksum8(buildPayloadString(p));
    const core = buildCoreString(p, cs);
    const expectedSyms = encodeToSymbols(core, 80);

    // Score each side: best match across all edge-offset candidates
    const sideScores = Object.values(strips).map(sideList => {
      let best = 0;
      for (const observed of sideList) {
        if (observed.length < 4) continue;
        const sc = seqSim(observed, expectedSyms);
        if (sc > best) best = sc;
      }
      return best;
    });

    sideScores.sort((a, b) => b - a);
    const composite = (sideScores[0] + (sideScores[1] || 0)) / 2;

    if (composite > bestScore) {
      bestScore = composite; bestRow = row; bestPayload = p;
      console.log(`[forensics] new best: score=${composite.toFixed(3)} sides=[${sideScores.map(s=>s.toFixed(2)).join(',')}] copy=${p.copyNumber} job=${p.jobId}`);
    }
    if (sideScores.filter(s => s >= 0.65).length >= 3) break;
  }

  // Random baseline = 25% for 4-symbol alphabet
  const THRESHOLD = 0.40;
  if (bestScore < THRESHOLD || !bestPayload) {
    console.log(`[forensics] shape decoder: best=${bestScore.toFixed(3)} below threshold=${THRESHOLD}`);
    return null;
  }

  console.log(`[forensics] shape decoder MATCH score=${bestScore.toFixed(3)}`);
  return {
    found: true, payload: bestPayload, forensicId: bestPayload.forensicId || null,
    recoveryLayer: 'border_shape_decode',
    confidence: Math.min(0.97, 0.50 + bestScore * 0.60),
    _matchedJobId: bestRow.job_id, _matchedOperatorId: bestRow.operator_id,
    _matchedCenterId: bestRow.center_id, _matchedCopyId: bestRow.copy_id
  };
}

// ─── Recovery entry point ────────────────────────────────────────────────────
async function recoverForensicMarkers(filePath, db) {
  // ── Detect file type FIRST before attempting PDF parse ──
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const isImage = ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'webp', 'gif'].includes(ext);

  if (isImage) {
    console.log(`[forensics] image file detected (${ext}), routing to OCR+pixel scanner`);
    const result = await recoverFromImage(filePath, db);
    if (result) return result;
    return { found: false, payload: null, forensicId: null, reason: 'Image scan: no match found above threshold', recoveryLayer: 'image_ocr_pixel', confidence: 0 };
  }

  // ── PDF path ──
  let pdfBytes;
  try { pdfBytes = fs.readFileSync(filePath); } catch (e) {
    return { found: false, payload: null, forensicId: null, reason: e.message, confidence: 0 };
  }

  // Check magic bytes — if not a PDF, go straight to image scanner
  if (!pdfBytes.slice(0, 5).toString('ascii').startsWith('%PDF')) {
    console.log('[forensics] file has no PDF header, trying image scanner');
    const result = await recoverFromImage(filePath, db);
    if (result) return result;
    return { found: false, payload: null, forensicId: null, reason: 'Not a PDF and image scan found no match', confidence: 0 };
  }

  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch (err) {
    console.log('[forensics] PDF load failed:', err.message, '— trying image scanner');
    const result = await recoverFromImage(filePath, db);
    if (result) return result;
    return { found: false, payload: null, forensicId: null, reason: err.message, confidence: 0 };
  }

  let payload = null, forensicId = null, recoveryLayer = null, confidence = 0;

  // Step 1 — keywords
  try {
    const kw  = pdfDoc.getKeywords() || '';
    const kwm = kw.match(/SPLFID:([A-Za-z0-9+/=]+)/);
    if (kwm) {
      payload = JSON.parse(Buffer.from(kwm[1], 'base64').toString('utf8'));
      recoveryLayer = 'metadata_keywords'; confidence = 0.98;
    }
  } catch {}

  // Step 2 — creator
  try {
    const creator = pdfDoc.getCreator() || '';
    if (creator.startsWith('SecurePrintLedger|')) {
      forensicId = creator.split('|')[1] || null;
      if (!payload) { recoveryLayer = 'metadata_creator'; confidence = 0.85; }
    }
  } catch {}

  // Step 3 — subject
  if (!payload) try {
    const sub = pdfDoc.getSubject() || '';
    if (sub.startsWith('SPL|')) {
      const p = {};
      sub.split('|').slice(1).forEach(s => { const [k, v] = s.split(':'); if (k && v) p[k.toLowerCase()] = v; });
      if (p.j || p.ctr) { payload = { jobId: p.j, copyNumber: p.c, operatorId: p.o, centerId: p.ctr, batchId: p.b, forensicId }; recoveryLayer = 'metadata_subject'; confidence = 0.80; }
    }
  } catch {}

  // Step 4 — author
  if (!payload) try {
    const auth = pdfDoc.getAuthor() || '';
    if (auth.includes('SPLOP:') || auth.includes('SPLCTR:')) {
      const om = auth.match(/SPLOP:([^|]+)/), cm = auth.match(/SPLCTR:([^|]+)/);
      if (om || cm) { payload = { operatorId: om?.[1], centerId: cm?.[1], forensicId }; recoveryLayer = 'metadata_author'; confidence = 0.65; }
    }
  } catch {}

  // Step 5 — producer
  if (!payload) try {
    const prod = pdfDoc.getProducer() || '';
    if (prod.startsWith('SPL-v2|')) {
      const pts = prod.split('|');
      payload = { batchId: pts[1], copyNumber: pts[2], forensicId }; recoveryLayer = 'metadata_producer'; confidence = 0.60;
    }
  } catch {}

  // Step 6 — micro-text grep on raw bytes
  if (!payload || confidence < 0.7) try {
    const raw = pdfBytes.toString('latin1');
    const m = raw.match(/CTR:(\S+)\s+CPY:(\S+)\s+JOB:(\S+)\s+([A-F0-9]{8})/);
    if (m) { payload = { centerId: m[1], copyNumber: m[2], jobId: m[3], checksum: m[4], forensicId: forensicId || null }; recoveryLayer = 'micro_text'; confidence = 0.75; }
  } catch {}

  if (payload) {
    if (forensicId && !payload.forensicId) payload.forensicId = forensicId;
    return { found: true, payload, forensicId: payload.forensicId || forensicId, recoveryLayer, confidence };
  }

  // Step 7 — scanned PDF: extract embedded images and run OCR on them
  // This handles PDFs that are just scanned images with no text layer
  console.log('[forensics] no text markers found, trying scanned-PDF image extraction');
  try {
    const Jimp = require('jimp').Jimp;
    // Extract JPEG/PNG streams embedded in the PDF raw bytes
    const rawBuf = pdfBytes;
    const imageBuffers = [];

    // Find JPEG streams (FF D8 ... FF D9)
    let pos = 0;
    while (pos < rawBuf.length - 2) {
      if (rawBuf[pos] === 0xFF && rawBuf[pos + 1] === 0xD8) {
        const end = rawBuf.indexOf(Buffer.from([0xFF, 0xD9]), pos + 2);
        if (end !== -1 && end - pos > 500) {
          imageBuffers.push(rawBuf.slice(pos, end + 2));
          pos = end + 2;
          continue;
        }
      }
      // Find PNG streams (89 50 4E 47)
      if (rawBuf[pos] === 0x89 && rawBuf[pos+1] === 0x50 && rawBuf[pos+2] === 0x4E && rawBuf[pos+3] === 0x47) {
        // PNG ends with IEND chunk: 00 00 00 00 49 45 4E 44 AE 42 60 82
        const iend = rawBuf.indexOf(Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]), pos);
        if (iend !== -1 && iend - pos > 500) {
          imageBuffers.push(rawBuf.slice(pos, iend + 8));
          pos = iend + 8;
          continue;
        }
      }
      pos++;
    }

    console.log(`[forensics] found ${imageBuffers.length} embedded images in PDF`);

    for (let ii = 0; ii < Math.min(imageBuffers.length, 6); ii++) {
      try {
        const tmpPath = filePath + `_extracted_img_${ii}.jpg`;
        fs.writeFileSync(tmpPath, imageBuffers[ii]);
        const result = await recoverFromImage(tmpPath, db);
        try { fs.unlinkSync(tmpPath); } catch {}
        if (result && result.found) {
          result.recoveryLayer = 'scanned_pdf_ocr';
          return result;
        }
      } catch {}
    }
  } catch (e) {
    console.log('[forensics] scanned PDF extraction failed:', e.message);
  }

  return { found: false, payload: null, forensicId: null, reason: 'No forensic markers found', recoveryLayer: null, confidence: 0 };
}

function generateForensicId(jobId, copyNumber, batchId) {
  return crypto.createHash('sha256').update(`${jobId}-${copyNumber}-${batchId}-${Date.now()}`).digest('hex').substring(0, 24).toUpperCase();
}

async function testEmbedForensicOverlay() {
  // Generate sample PDF and apply overlay, without needing server/dev.
  const outPath = path.join(__dirname, '..', 'uploads', 'generated', 'test_forensic_qr_overlay.pdf');

  // Ensure dir exists
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const samplePayload = {
    forensicId: 'FORQROVERLAYDEMOID0000001',
    jobId: 'JOB-DEMO-1',
    copyNumber: 1,
    operatorId: 'OP-DEM0',
    centerId: '1',
    batchId: 'BATCH-DEMO-1',
    timestamp: new Date().toISOString()
  };

  const payloadStr = buildPayloadString(samplePayload);
  const cs = checksum8(payloadStr);

  // Create a blank PDF via pdf-lib and embed overlay
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4-ish
  const font = await doc.embedFont(StandardFonts.Helvetica);

  embedMetadata(doc, samplePayload, payloadStr, cs);

  await embedBorderLayer(page, samplePayload, payloadStr, cs, font);

  const bytes = await doc.save();
  fs.writeFileSync(outPath, bytes);

  return { success: true, outPath };
}

// Export for external runner/test harness
module.exports = { embedForensicMarkers, recoverForensicMarkers, generateForensicId, testEmbedForensicOverlay };
