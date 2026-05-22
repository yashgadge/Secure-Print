// Load environment variables manually
try {
  require('dotenv').config();
} catch (e) {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
          value = value.replace(/\\n/gm, '\n');
        }
        process.env[key] = value.replace(/(^['"]|['"]$)/g, '').trim();
      }
    }
  }
}

const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure upload dirs exist
['uploads/original', 'uploads/generated', 'uploads/leaks', 'uploads/reports'].forEach(dir => {
  const full = path.join(__dirname, '..', dir);
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'secureprint-ledger-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 }
}));

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// File upload config
const originalStorage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'original'),
  filename: (req, file, cb) => cb(null, `${uuidv4()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
});
const leakStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'leaks');
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${uuidv4()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
});

const uploadOriginal = multer({ storage: originalStorage, limits: { fileSize: 50 * 1024 * 1024 } });
const uploadLeak = multer({
  storage: leakStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /pdf|jpeg|jpg|png|bmp|tiff|webp/i;
    cb(null, allowed.test(file.mimetype) || allowed.test(path.extname(file.originalname)));
  }
});

// File upload endpoints
app.post('/api/upload/master', uploadOriginal.single('file'), (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { log } = require('./db');
  log('admin', req.session.userId, 'master_uploaded', 'file', req.file.filename, `Master file uploaded: ${req.file.originalname}`);
  res.json({ success: true, filename: req.file.filename, originalName: req.file.originalname, size: req.file.size });
});

app.post('/api/upload/leak', uploadLeak.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ success: true, filename: req.file.filename, originalName: req.file.originalname });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/operators', require('./routes/operators'));
app.use('/api/centers', require('./routes/centers'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/leaks', require('./routes/leaks'));
app.use('/api/admin', require('./routes/admin'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`SecurePrint Ledger running on http://localhost:${PORT}`);
  });
}

module.exports = app;

