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
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL;
const UPLOADS_BASE = isProduction ? '/tmp/uploads' : path.join(__dirname, '..', 'uploads');

// Ensure upload dirs exist
['original', 'generated', 'leaks', 'reports'].forEach(dir => {
  const full = path.join(UPLOADS_BASE, dir);
  if (!fs.existsSync(full)) {
    try {
      fs.mkdirSync(full, { recursive: true });
    } catch (e) {
      console.error(`Failed to create directory ${full}:`, e);
    }
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Custom stateless cookie-based session middleware to support Vercel serverless deployment
app.use((req, res, next) => {
  const cookieName = 'session_token';
  
  const parseCookies = (cookieHeader) => {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const name = parts.shift().trim();
      const val = parts.join('=');
      list[name] = decodeURIComponent(val);
    });
    return list;
  };

  const cookies = parseCookies(req.headers.cookie);
  const sessionCookie = cookies[cookieName];
  
  let sessionData = {};
  if (sessionCookie) {
    try {
      const json = Buffer.from(sessionCookie, 'base64').toString('utf8');
      sessionData = JSON.parse(json);
    } catch (err) {
      console.error("[Session] Failed to parse session cookie:", err);
    }
  }

  req.session = sessionData;

  req.session.destroy = (cb) => {
    req.session = {};
    res.clearCookie(cookieName, { path: '/' });
    if (cb) cb();
  };

  const originalWriteHead = res.writeHead;
  const originalEnd = res.end;
  let headersSent = false;

  const saveSession = () => {
    if (headersSent) return;
    headersSent = true;
    
    if (req.session && Object.keys(req.session).length > 0) {
      try {
        const jsonStr = JSON.stringify(req.session);
        const cookieVal = Buffer.from(jsonStr).toString('base64');
        res.cookie(cookieName, cookieVal, { path: '/', httpOnly: true, maxAge: 3600000 });
      } catch (err) {
        console.error("[Session] Failed to serialize session:", err);
      }
    }
  };

  res.writeHead = function(...args) {
    saveSession();
    return originalWriteHead.apply(this, args);
  };

  res.end = function(...args) {
    saveSession();
    return originalEnd.apply(this, args);
  };

  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/uploads', express.static(UPLOADS_BASE));

// File upload config
const originalStorage = multer.diskStorage({
  destination: path.join(UPLOADS_BASE, 'original'),
  filename: (req, file, cb) => cb(null, `${uuidv4()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
});
const leakStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_BASE, 'leaks');
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

