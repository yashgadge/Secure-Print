# TODO - SecurePrint Ledger QR/MicroText/Minimal Border Layer

- [ ] Update `backend/pdf_forensics.js`:
  - [ ] Install/use `qrcode` library (add dependency)
  - [ ] Add QR code overlay on every page bottom-right safe zone
  - [ ] Add micro-text overlay near QR (6–7pt) as readable fallback
  - [ ] Replace existing thick border/bands overlay behavior with minimal thin #999999 0.5pt border line (do not add grey fill)
  - [ ] Ensure QR + micro-text support later image recovery (encoding contains JSON with jobId/copyNumber/operatorId/centerId/batchId/timestamp/forensicId)
- [ ] Update `generateForensicId` if needed (include new fields—ensure forensicId remains stable)
- [ ] Add a test utility/function in `backend/pdf_forensics.js` that generates a sample PDF with QR + micro-text + minimal border overlay.
- [ ] Verify Node server runs after dependency changes.

