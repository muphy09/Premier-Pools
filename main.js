const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Lightweight env loader so dev runs pick up Supabase config from .env/.env.local
function loadLocalEnv() {
  const envFiles = ['.env.local', '.env'];
  envFiles.forEach((file) => {
    const fullPath = path.join(__dirname, file);
    if (!fs.existsSync(fullPath)) return;
    const lines = fs.readFileSync(fullPath, 'utf-8').split(/\r?\n/);
    lines.forEach((line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) return;
      const [, key, raw] = match;
      if (process.env[key]) return; // keep explicit env overrides
      const value = raw.replace(/^['"]|['"]$/g, '');
      process.env[key] = value;
    });
  });
}

// Load native dependency with a guard so startup failures surface a readable error instead of "application can't be opened"
let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  // Defer error handling until app is ready if needed
  if (app && app.getPath) {
    const logDir = app.getPath('userData');
    const logPath = path.join(logDir, 'startup-error.log');
    try {
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(logPath, `${new Date().toISOString()} Failed to load better-sqlite3\n${err.stack || err.message}\n`);
    } catch (_) {
      // ignore log write issues
    }
    dialog.showErrorBox('Startup error', `Failed to start Proposal Builder due to a native module error.\n\nDetails written to:\n${logPath}\n\n${err.message}`);
    app.quit();
  } else {
    // App not ready yet, log to console and rethrow
    console.error('Failed to load better-sqlite3:', err);
    throw err;
  }
}

// Ensure env vars are available before any renderer/preload needs them
loadLocalEnv();

// Handle ASAR paths correctly
const isDev = process.env.NODE_ENV === 'development';
// Surface the app version to the preload script without requiring package.json there
try {
  process.env.SUBMERGE_APP_VERSION = app.getVersion();
} catch (e) {
  // Fallback to package.json if app not ready yet
  process.env.SUBMERGE_APP_VERSION = require('./package.json').version;
}
let appPath = __dirname;
let iconPath = path.join(__dirname, 'icon.ico');
const APP_NAME = 'Submerge Proposal Builder';
const DEFAULT_WINDOW_TITLE = 'Proposal Builder';
const PROPOSAL_FILE_EXTENSION = '.submerge';
const DATA_PARTITION = String(process.env.SUBMERGE_DATA_PARTITION || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, '');
const WINDOW_TITLE = DATA_PARTITION
  ? `${DEFAULT_WINDOW_TITLE} [${DATA_PARTITION.toUpperCase()}]`
  : DEFAULT_WINDOW_TITLE;

if (DATA_PARTITION) {
  const isolatedUserDataPath = path.join(app.getPath('appData'), `${APP_NAME}-${DATA_PARTITION}`);
  app.setPath('userData', isolatedUserDataPath);
  console.log(`Using isolated ${DATA_PARTITION} application data.`);
}

let mainWindow = null;
let db = null;
let proposalsDir = null;
let updateClient = null;
const contractPreviewWindows = new Set();
const contractPreviewPayloads = new Map();
const contractPreviewTempDirs = new Set();

const UPDATE_FEED = {
  provider: 'github',
  owner: 'muphy09',
  repo: 'Submerge-App',
};
const UPDATE_DOWNLOAD_BASE = 'https://github.com/muphy09/Submerge-App/releases/download';
const CSP_DIRECTIVES = [
  "default-src 'self'",
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173"
    : "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: file: blob:",
  "font-src 'self' data:",
  isDev
    ? "connect-src 'self' blob: http://localhost:5173 ws://localhost:5173 https://*.supabase.co"
    : "connect-src 'self' blob: https://*.supabase.co",
  "media-src 'self' blob: file:",
  "object-src 'none'",
  "frame-ancestors 'none'",
];
const CSP_HEADER = CSP_DIRECTIVES.join('; ');
const DEFAULT_FRANCHISE_ID = 'default';
const DEFAULT_FRANCHISE_CODE = 'DEFAULT-CODE';
const DEFAULT_PRICING_VERSION = 'v1';

function getAutoUpdater() {
  if (isDev) {
    return null;
  }

  if (!updateClient) {
    const { autoUpdater } = require('electron-updater');
    updateClient = autoUpdater;

    try {
      const feedConfig = { ...UPDATE_FEED };
      if (process.env.GH_TOKEN) {
        feedConfig.token = process.env.GH_TOKEN;
      }
      updateClient.setFeedURL(feedConfig);
      console.log('Auto-update feed configured for GitHub releases');
    } catch (error) {
      console.error('Failed to configure auto-updater feed:', error);
    }

    updateClient.autoDownload = false;
    updateClient.autoInstallOnAppQuit = true;
  }

  return updateClient;
}

function buildRendererUrl(hashPath = '') {
  const normalizedHashPath = hashPath
    ? `#${hashPath.startsWith('/') ? hashPath : `/${hashPath}`}`
    : '';

  if (isDev) {
    return `http://localhost:5173/${normalizedHashPath}`;
  }

  const indexPath = `file://${path.join(appPath, 'dist/renderer/index.html').replace(/\\/g, '/')}`;
  return `${indexPath}${normalizedHashPath}`;
}

function sendUpdateError(message = 'Error checking for updates') {
  if (mainWindow) {
    mainWindow.webContents.send('update-error', message);
  }
}

// Initialize proposals directory
function initializeProposalsDirectory() {
  proposalsDir = DATA_PARTITION
    ? path.join(app.getPath('userData'), 'proposals')
    : path.join(app.getPath('documents'), APP_NAME);

  // Create directory if it doesn't exist
  if (!fs.existsSync(proposalsDir)) {
    fs.mkdirSync(proposalsDir, { recursive: true });
    console.log('Created proposals directory:', proposalsDir);
  }

  console.log('Proposals directory:', proposalsDir);
  return proposalsDir;
}

// Database initialization (for reference data only)
function initializeDatabase() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'pool-proposals.db');
  const isNewDatabase = !fs.existsSync(dbPath);

  console.log('Database path:', dbPath);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const schemaPath = path.join(appPath, 'src/database/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  // For existing databases, add franchise_code before running schema (indexes depend on it).
  if (!isNewDatabase) {
    try {
      const columns = db.prepare(`PRAGMA table_info('franchises')`).all() || [];
      const hasFranchiseCode = columns.some((c) => c.name === 'franchise_code');
      if (!hasFranchiseCode) {
        db.exec(`ALTER TABLE franchises ADD COLUMN franchise_code TEXT NOT NULL DEFAULT '${DEFAULT_FRANCHISE_CODE}';`);
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_franchises_code ON franchises(franchise_code);`);
        console.log('Added franchise_code column to franchises table (migration).');
      }
      backfillFranchiseCodes();
    } catch (error) {
      console.warn('Failed to verify/alter franchises table before schema exec:', error);
    }
  }

  // Read and execute schema (creates tables/indexes if missing)
  db.exec(schema);
  ensurePricingModelHiddenFlagColumn();

  // Migrate any legacy single-pricing rows into pricing models
  migrateFranchisePricingToModels();

  // Load sample data if this is a new database
  if (isNewDatabase) {
    try {
      const sampleDataPath = path.join(appPath, 'src/database/sampleData.sql');
      const sampleData = fs.readFileSync(sampleDataPath, 'utf-8');
      db.exec(sampleData);
      console.log('Sample data loaded successfully');
    } catch (error) {
      console.warn('Failed to load sample data:', error);
    }
  }

  ensureDefaultFranchise();
  ensureStarterFranchises();
  console.log('Database initialized successfully');
}

function ensureFranchiseExists(franchiseId, name = franchiseId, franchiseCode = DEFAULT_FRANCHISE_CODE) {
  if (!db || !franchiseId) return;
  const now = new Date().toISOString();
  const resolvedCode = !franchiseCode || (franchiseCode === DEFAULT_FRANCHISE_CODE && franchiseId !== DEFAULT_FRANCHISE_ID)
    ? (franchiseId === DEFAULT_FRANCHISE_ID ? DEFAULT_FRANCHISE_CODE : `${franchiseId}-CODE`)
    : franchiseCode;
  db.prepare(
    `INSERT OR IGNORE INTO franchises (id, name, franchise_code, is_active, created_at, updated_at)
     VALUES (@id, @name, @code, 0, @now, @now)`
  ).run({ id: franchiseId, name, code: resolvedCode, now });
}

function backfillFranchiseCodes() {
  if (!db) return;
  try {
    const rows = db
      .prepare(`SELECT id, COALESCE(franchise_code, '') AS franchise_code FROM franchises WHERE franchise_code IS NULL OR franchise_code = ''`)
      .all();
    const now = new Date().toISOString();
    const update = db.prepare(
      `UPDATE franchises SET franchise_code = @code, updated_at = @now WHERE id = @id`
    );
    rows.forEach((row) => {
      const generatedCode = `${row.id || DEFAULT_FRANCHISE_ID}-CODE`;
      update.run({ id: row.id, code: generatedCode, now });
    });
  } catch (error) {
    console.warn('Failed to backfill franchise codes:', error);
  }
}

function ensurePricingModelHiddenFlagColumn() {
  if (!db) return;
  try {
    const columns = db.prepare(`PRAGMA table_info('franchise_pricing_models')`).all() || [];
    const hasHiddenFlag = columns.some((c) => c.name === 'is_hidden_from_view');
    if (!hasHiddenFlag) {
      db.exec(`ALTER TABLE franchise_pricing_models ADD COLUMN is_hidden_from_view INTEGER NOT NULL DEFAULT 0;`);
      console.log('Added is_hidden_from_view column to franchise_pricing_models table (migration).');
    }
  } catch (error) {
    console.warn('Failed to verify/alter franchise_pricing_models table:', error);
  }
}

function ensureDefaultFranchise() {
  if (!db) return null;
  const now = new Date().toISOString();
  const total = db.prepare('SELECT COUNT(*) AS count FROM franchises').get();
  if (!total || total.count === 0) {
    db.prepare(
      `INSERT INTO franchises (id, name, franchise_code, is_active, created_at, updated_at)
       VALUES (@id, @name, @code, 1, @now, @now)`
    ).run({ id: DEFAULT_FRANCHISE_ID, name: 'Default Franchise', code: DEFAULT_FRANCHISE_CODE, now });
  }
  backfillFranchiseCodes();

  const active = db
    .prepare(
      `SELECT id, name, franchise_code AS franchiseCode, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
       FROM franchises WHERE is_active = 1 LIMIT 1`
    )
    .get();

  if (active) {
    return active;
  }

  const first = db.prepare('SELECT id FROM franchises LIMIT 1').get();
  if (first) {
    db.prepare(
      `UPDATE franchises
       SET is_active = CASE WHEN id = @id THEN 1 ELSE 0 END,
           updated_at = @now`
    ).run({ id: first.id, now });
  }

  return db
    .prepare(
      `SELECT id, name, franchise_code AS franchiseCode, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
       FROM franchises WHERE is_active = 1 LIMIT 1`
    )
    .get();
}

function migrateFranchisePricingToModels() {
  if (!db) return;
  try {
    const existingModels = db.prepare('SELECT COUNT(*) AS count FROM franchise_pricing_models').get();
    if (existingModels && existingModels.count > 0) {
      return;
    }

    const legacyRows =
      db
        .prepare(
          `SELECT franchise_id, version, pricing_json, updated_at, updated_by
           FROM franchise_pricing`
        )
        .all() || [];

    const insertModel = db.prepare(
      `INSERT INTO franchise_pricing_models
       (id, franchise_id, name, version, pricing_json, is_default, is_hidden_from_view, created_at, updated_at, updated_by)
       VALUES (@id, @franchise_id, @name, @version, @pricing_json, @is_default, @is_hidden_from_view, @created_at, @updated_at, @updated_by)`
    );

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      legacyRows.forEach((row, idx) => {
        const id = `${row.franchise_id || DEFAULT_FRANCHISE_ID}-legacy-${idx || 0}`;
        insertModel.run({
          id,
          franchise_id: row.franchise_id || DEFAULT_FRANCHISE_ID,
          name: 'Legacy Default',
          version: row.version || DEFAULT_PRICING_VERSION,
          pricing_json: row.pricing_json,
          is_default: 1,
          is_hidden_from_view: 0,
          created_at: row.updated_at || now,
          updated_at: row.updated_at || now,
          updated_by: row.updated_by || null,
        });
      });
    });
    tx();
    console.log('Migrated legacy franchise_pricing rows into franchise_pricing_models');
  } catch (error) {
    console.warn('Failed to migrate legacy franchise pricing:', error);
  }
}

function ensureStarterFranchises() {
  ensureFranchiseExists('franchise-1111', 'Franchise 1111', '1111');
  ensureFranchiseExists('franchise-2222', 'Franchise 2222', '2222');
}

function getActiveFranchise() {
  if (!db) throw new Error('Database not initialized');
  const active = db
    .prepare(
      `SELECT id, name, franchise_code AS franchiseCode, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
       FROM franchises WHERE is_active = 1 LIMIT 1`
    )
    .get();
  return active || ensureDefaultFranchise();
}

function setActiveFranchise(franchiseId) {
  if (!db) throw new Error('Database not initialized');
  let exists = db.prepare('SELECT COUNT(*) AS count FROM franchises WHERE id = ?').get(franchiseId);
  if (!exists || exists.count === 0) {
    ensureFranchiseExists(franchiseId);
    exists = db.prepare('SELECT COUNT(*) AS count FROM franchises WHERE id = ?').get(franchiseId);
  }
  if (!exists || exists.count === 0) {
    throw new Error(`Franchise not found: ${franchiseId}`);
  }

  const now = new Date().toISOString();
  const tx = db.transaction((id) => {
    db.prepare('UPDATE franchises SET is_active = 0').run();
    db.prepare('UPDATE franchises SET is_active = 1, updated_at = ? WHERE id = ?').run(now, id);
  });

  tx(franchiseId);
  return getActiveFranchise();
}

function getFranchiseByCode(code) {
  if (!db) throw new Error('Database not initialized');
  return db
    .prepare(
      `SELECT id, name, franchise_code AS franchiseCode, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
       FROM franchises WHERE franchise_code = ?`
    )
    .get(code);
}

function getDefaultPricingModel(franchiseId) {
  if (!db) throw new Error('Database not initialized');
  return (
    db
      .prepare(
        `SELECT id, name, version, pricing_json AS pricingJson, is_default AS isDefault, updated_at AS updatedAt,
                updated_by AS updatedBy, is_hidden_from_view AS isHiddenFromView
         FROM franchise_pricing_models
         WHERE franchise_id = ?
         ORDER BY is_default DESC, updated_at DESC
         LIMIT 1`
      )
      .get(franchiseId) || null
  );
}

function getPricingModelById(franchiseId, modelId) {
  if (!db) throw new Error('Database not initialized');
  return (
    db
      .prepare(
        `SELECT id, name, version, pricing_json AS pricingJson, is_default AS isDefault, updated_at AS updatedAt,
                updated_by AS updatedBy, is_hidden_from_view AS isHiddenFromView
         FROM franchise_pricing_models
         WHERE franchise_id = ? AND id = ?`
      )
      .get(franchiseId, modelId) || null
  );
}

// Auto-updater configuration
function setupAutoUpdater() {
  // Don't check for updates in development
  if (isDev) {
    console.log('Skipping auto-updater in development mode');
    return;
  }

  const autoUpdater = getAutoUpdater();
  if (!autoUpdater) {
    return;
  }

  autoUpdater.removeAllListeners();
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info);
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
    }
    // Auto-download the update
    autoUpdater.downloadUpdate().catch((error) => {
      console.error('Failed to download update:', error);
      sendUpdateError();
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('Update not available:', info);
    if (mainWindow) {
      mainWindow.webContents.send('update-not-available', info);
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Error in auto-updater:', err);
    sendUpdateError();
  });

  autoUpdater.on('download-progress', (progressObj) => {
    console.log('Download progress:', progressObj);
    if (mainWindow) {
      mainWindow.webContents.send('download-progress', progressObj);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info);
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info);
    }
  });

  autoUpdater.on('before-quit-for-update', () => {
    cleanupAppResources();
  });

  // The renderer starts the check only after login, when the correct franchise
  // release channel is known. Checking the generic feed here could deliver a
  // different franchise's build before the user is identified.
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: WINDOW_TITLE,
    icon: iconPath,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-script.js'),
    },
  });

  // Show as maximized (windowed fullscreen) once ready to avoid flicker.
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Enforce CSP via HTTP header so directives like frame-ancestors are honored in dev and prod.
  const session = mainWindow.webContents.session;
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    headers['Content-Security-Policy'] = [CSP_HEADER];
    callback({ responseHeaders: headers });
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Hide the default menu bar in production builds
    Menu.setApplicationMenu(null);

    // Use URL-based loading for proper asset resolution in ASAR
    const indexPath = `file://${path.join(appPath, 'dist/renderer/index.html').replace(/\\/g, '/')}`;
    console.log('Loading production app from:', indexPath);
    console.log('__dirname:', __dirname);
    console.log('appPath:', appPath);

    mainWindow.loadURL(indexPath).catch(err => {
      console.error('Failed to load index.html:', err);
    });

    // Open dev tools in production to debug
    // mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Page failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    openPendingProposalFile();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

let fileToOpen = null;

function openProposalFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const proposal = JSON.parse(data);

    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('open-proposal', proposal);
    } else {
      fileToOpen = filePath;
    }
  } catch (error) {
    console.error('Failed to open proposal file:', error);
  }
}

function extractProposalFilePath(argv = []) {
  if (!Array.isArray(argv)) {
    return null;
  }

  for (const arg of argv) {
    if (typeof arg !== 'string') {
      continue;
    }

    const candidate = arg.replace(/^"+|"+$/g, '');
    if (candidate.toLowerCase().endsWith(PROPOSAL_FILE_EXTENSION)) {
      return candidate;
    }
  }

  return null;
}

function queueProposalFileOpen(filePath) {
  const candidate = typeof filePath === 'string' ? filePath.replace(/^"+|"+$/g, '') : '';
  if (!candidate || !candidate.toLowerCase().endsWith(PROPOSAL_FILE_EXTENSION)) {
    return false;
  }

  fileToOpen = candidate;
  return true;
}

function openPendingProposalFile() {
  if (!fileToOpen) {
    return;
  }

  const pendingFilePath = fileToOpen;
  fileToOpen = null;
  openProposalFile(pendingFilePath);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  return true;
}

function handleProposalOpenRequest(filePath) {
  if (!queueProposalFileOpen(filePath)) {
    return;
  }

  if (!focusMainWindow()) {
    if (app.isReady()) {
      createWindow();
    }
    return;
  }

  if (!mainWindow.webContents.isLoadingMainFrame()) {
    openPendingProposalFile();
  }
}

function checkForFileArgument(argv = process.argv) {
  if (process.platform !== 'win32' || argv.length < 2) {
    return;
  }

  const filePath = extractProposalFilePath(argv);
  if (filePath) {
    queueProposalFileOpen(filePath);
  }
}

function cleanupAppResources() {
  contractPreviewTempDirs.forEach((targetPath) => {
    cleanupTempPath(targetPath);
  });
  contractPreviewTempDirs.clear();

  if (db) {
    try {
      db.close();
    } catch (error) {
      console.warn('Failed to close database during shutdown:', error);
    }
    db = null;
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const filePath = extractProposalFilePath(commandLine);
    if (filePath) {
      handleProposalOpenRequest(filePath);
      return;
    }

    if (!focusMainWindow() && app.isReady()) {
      createWindow();
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    handleProposalOpenRequest(filePath);
  });

  app.whenReady().then(() => {
    // Set app path correctly after app is ready
    if (!isDev) {
      appPath = app.getAppPath();
      iconPath = path.join(appPath, 'icon.ico');
    }

    // Check for file argument
    checkForFileArgument();

    try {
      initializeDatabase();
    } catch (error) {
      console.error('Failed to initialize database:', error);
      dialog.showErrorBox('Database error', `Failed to initialize database:\n\n${error.message}`);
      app.quit();
      return;
    }
    initializeProposalsDirectory();
    createWindow();
    setupAutoUpdater();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else {
        focusMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      cleanupAppResources();
      app.quit();
    }
  });

  app.on('before-quit', () => {
    cleanupAppResources();
  });
}

// IPC Handlers - Proposals
const PROPOSAL_RECOVERY_SUFFIX = '.recovery';

function readProposalFileWithRecovery(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (primaryError) {
    const recoveryPath = `${filePath}${PROPOSAL_RECOVERY_SUFFIX}`;
    if (!fs.existsSync(recoveryPath)) throw primaryError;
    try {
      const recovered = JSON.parse(fs.readFileSync(recoveryPath, 'utf-8'));
      console.warn(`Recovered proposal from ${path.basename(recoveryPath)} after the primary file could not be read.`);
      return recovered;
    } catch (_) {
      throw primaryError;
    }
  }
}

function writeProposalFileAtomically(filePath, proposal) {
  const serialized = JSON.stringify(proposal, null, 2);
  JSON.parse(serialized);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const recoveryPath = `${filePath}${PROPOSAL_RECOVERY_SUFFIX}`;
  let handle = null;

  try {
    handle = fs.openSync(temporaryPath, 'w');
    fs.writeFileSync(handle, serialized, 'utf-8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;

    if (fs.existsSync(filePath)) {
      try {
        JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.copyFileSync(filePath, recoveryPath);
      } catch (_) {
        // Keep the last known-good recovery file when the current file is unreadable.
      }
    }

    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch (_) {
        // Ignore cleanup errors and surface the original save failure.
      }
    }
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch (_) {
      // Ignore cleanup errors and surface the original save failure.
    }
    throw error;
  }
}

ipcMain.handle('save-proposal', async (_, proposal) => {
  if (!proposalsDir) throw new Error('Proposals directory not initialized');

  console.log('save-proposal called for:', proposal?.proposalNumber || 'unknown proposal');

  try {
    // Check if this proposal already exists (editing existing proposal)
    const files = fs.readdirSync(proposalsDir);
    let existingFilePath = null;

    // Look for existing file by proposal number
    for (const file of files) {
      if (file.endsWith(PROPOSAL_FILE_EXTENSION)) {
        try {
          const filePath = path.join(proposalsDir, file);
          const existingProposal = readProposalFileWithRecovery(filePath);
          if (existingProposal.proposalNumber === proposal.proposalNumber) {
            existingFilePath = filePath;
            console.log('Found existing file:', filePath);
            break;
          }
        } catch (error) {
          // Skip files that can't be read
        }
      }
    }

    let filePath;
    if (existingFilePath) {
      // Reuse existing file path
      filePath = existingFilePath;
    } else {
      // Create new filename using customer name or proposal number
      let fileName;
      if (proposal.customerInfo && proposal.customerInfo.customerName && proposal.customerInfo.customerName.trim()) {
        // Use customer name, remove special characters, limit length
        const safeName = proposal.customerInfo.customerName.trim().replace(/[^a-zA-Z0-9]/g, '-').substring(0, 50);
        fileName = `${safeName}${PROPOSAL_FILE_EXTENSION}`;
      } else {
        // Fallback to proposal number
        fileName = `${proposal.proposalNumber}${PROPOSAL_FILE_EXTENSION}`;
      }
      filePath = path.join(proposalsDir, fileName);
      console.log('Creating new file:', filePath);
    }

    // Commit through a same-directory temporary file so a crash cannot leave partial JSON.
    writeProposalFileAtomically(filePath, proposal);

    console.log('Proposal saved successfully:', filePath);
    return filePath;
  } catch (error) {
    console.error('Failed to save proposal:', error);
    throw error;
  }
});

ipcMain.handle('get-proposal', async (_, proposalNumber) => {
  if (!proposalsDir) throw new Error('Proposals directory not initialized');

  console.log('get-proposal called with:', proposalNumber);

  try {
    // Find the file by proposal number
    const files = fs.readdirSync(proposalsDir);
    console.log('Files in proposals dir:', files);

    for (const file of files) {
      if (file.endsWith(PROPOSAL_FILE_EXTENSION)) {
        try {
          const filePath = path.join(proposalsDir, file);
          const proposal = readProposalFileWithRecovery(filePath);

          console.log('Checking file:', file, 'proposalNumber:', proposal.proposalNumber);

          if (proposal.proposalNumber === proposalNumber) {
            console.log('FOUND proposal:', proposal.proposalNumber);
            return proposal;
          }
        } catch (error) {
          console.error(`Failed to read proposal file ${file}:`, error);
        }
      }
    }

    // Quietly return null when the proposal is not present (likely already deleted)
    // console.debug('Proposal not found:', proposalNumber);
    return null;
  } catch (error) {
    console.error('Failed to load proposal:', error);
    return null;
  }
});

function readAllProposalFilesWithReport() {
  if (!proposalsDir) throw new Error('Proposals directory not initialized');

  try {
    const files = fs.readdirSync(proposalsDir);
    const entries = [];
    const issues = [];

    for (const file of files) {
      if (file.endsWith(PROPOSAL_FILE_EXTENSION)) {
        const filePath = path.join(proposalsDir, file);
        try {
          const proposal = readProposalFileWithRecovery(filePath);
          entries.push({ proposal, fileName: file });
        } catch (error) {
          console.error(`Failed to read proposal file ${file}:`, error);
          issues.push({
            fileName: file,
            message: String(error?.message || 'The local proposal file could not be read.'),
          });
        }
      }
    }

    // Sort by last modified date (most recent first)
    entries.sort(
      (a, b) => new Date(b.proposal?.lastModified) - new Date(a.proposal?.lastModified)
    );

    return { entries, issues };
  } catch (error) {
    console.error('Failed to load proposals:', error);
    return {
      entries: [],
      issues: [{
        fileName: 'Local proposals folder',
        message: String(error?.message || 'The local proposals folder could not be read.'),
      }],
    };
  }
}

ipcMain.handle('get-all-proposals', async () => {
  const report = readAllProposalFilesWithReport();
  return report.entries.map((entry) => entry.proposal);
});

ipcMain.handle('get-all-proposals-with-report', async () => {
  return readAllProposalFilesWithReport();
});

ipcMain.handle('delete-proposal', async (_, proposalNumber) => {
  if (!proposalsDir) throw new Error('Proposals directory not initialized');

  try {
    // Find the file by proposal number
    const files = fs.readdirSync(proposalsDir);

    for (const file of files) {
      if (file.endsWith(PROPOSAL_FILE_EXTENSION)) {
        try {
          const filePath = path.join(proposalsDir, file);
          const proposal = readProposalFileWithRecovery(filePath);

          if (proposal.proposalNumber === proposalNumber) {
            fs.unlinkSync(filePath);
            const recoveryPath = `${filePath}${PROPOSAL_RECOVERY_SUFFIX}`;
            if (fs.existsSync(recoveryPath)) fs.unlinkSync(recoveryPath);
            console.log('Proposal deleted:', filePath);
            return;
          }
        } catch (error) {
          console.error(`Failed to read/delete proposal file ${file}:`, error);
        }
      }
    }

    // Swallow missing-proposal deletes to avoid noisy logs during resync
    // console.debug('Proposal not found:', proposalNumber);
  } catch (error) {
    console.error('Failed to delete proposal:', error);
    throw error;
  }
});

// New handler to open proposals folder
ipcMain.handle('open-proposals-folder', async () => {
  if (!proposalsDir) throw new Error('Proposals directory not initialized');

  try {
    await shell.openPath(proposalsDir);
  } catch (error) {
    console.error('Failed to open proposals folder:', error);
    throw error;
  }
});

function readFirstExistingText(possiblePaths, missingMessage) {
  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  }

  throw new Error(missingMessage);
}

function findFranchiseReleaseNotesDirectory() {
  const possibleDirectories = [
    path.join(appPath, 'release-notes', 'franchises'),
    path.join(__dirname, 'release-notes', 'franchises'),
    path.join(process.cwd(), 'release-notes', 'franchises'),
  ];

  return possibleDirectories.find((directoryPath) => fs.existsSync(directoryPath)) || null;
}

function readFranchiseReleaseNoteFiles(payload = {}) {
  const notesDirectory = findFranchiseReleaseNotesDirectory();
  if (!notesDirectory) return [];

  const role = String(payload?.role || '').trim().toLowerCase();
  const franchiseCode = String(payload?.franchiseCode || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  const noteFileNames = role === 'master'
    ? fs.readdirSync(notesDirectory).filter((fileName) => /^[a-z0-9-]+\.md$/i.test(fileName)).sort()
    : franchiseCode
      ? [`${franchiseCode}.md`]
      : [];

  const suppliedFranchises = Array.isArray(payload?.franchises) ? payload.franchises : [];
  const suppliedNameByCode = new Map(
    suppliedFranchises
      .map((franchise) => [
        String(franchise?.franchiseCode || '').trim().toLowerCase(),
        String(franchise?.name || '').trim(),
      ])
      .filter(([code, name]) => code && name)
  );

  const resolveFranchiseName = (code) => {
    const suppliedName = suppliedNameByCode.get(code);
    if (suppliedName) return suppliedName;

    if (db) {
      try {
        const localFranchise = db
          .prepare('SELECT name FROM franchises WHERE lower(franchise_code) = ? LIMIT 1')
          .get(code);
        const localName = String(localFranchise?.name || '').trim();
        if (localName) return localName;
      } catch (error) {
        console.warn(`Unable to resolve the display name for franchise ${code}:`, error);
      }
    }

    return code.toUpperCase();
  };

  return noteFileNames
    .map((fileName) => {
      const filePath = path.join(notesDirectory, fileName);
      if (!fs.existsSync(filePath)) return null;

      const code = path.basename(fileName, path.extname(fileName)).toLowerCase();
      return {
        code,
        name: resolveFranchiseName(code),
        notes: fs.readFileSync(filePath, 'utf-8').trim(),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
}

// Changelog handler. Keep global and franchise notes separate so the renderer
// can present them as distinct tabs. Franchise notes are filtered to the
// authenticated franchise; master users can review all franchise notes.
ipcMain.handle('read-changelog', (_event, payload = {}) => {
  const role = String(payload?.role || '').trim().toLowerCase();
  const canViewGlobalNotes = role === 'master' || role === 'owner' || role === 'admin';
  const possiblePaths = [
    path.join(appPath, 'CHANGELOG.md'),
    path.join(__dirname, 'CHANGELOG.md'),
    path.join(process.cwd(), 'CHANGELOG.md'),
  ];
  const globalNotes = canViewGlobalNotes
    ? readFirstExistingText(possiblePaths, 'CHANGELOG.md not found').trim()
    : '';
  const franchiseNoteGroups = readFranchiseReleaseNoteFiles(payload);
  const franchiseNotes = franchiseNoteGroups
    .map((group) => group.notes)
    .filter(Boolean)
    .join('\n\n-----\n\n');
  return { globalNotes, franchiseNotes, franchiseNoteGroups };
});

function ensurePdfExtension(filePath) {
  if (!filePath) return filePath;
  return path.extname(filePath) ? filePath : `${filePath}.pdf`;
}

function sanitizePdfFileName(fileName, fallback = 'contract.pdf') {
  const rawName = typeof fileName === 'string' ? fileName.trim() : '';
  const safeName = rawName.replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').trim();
  return ensurePdfExtension(safeName || fallback);
}

function toPdfBuffer(input) {
  if (!input) {
    throw new Error('No PDF data was provided for printing.');
  }
  if (Buffer.isBuffer(input)) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }
  if (Array.isArray(input)) {
    return Buffer.from(input);
  }
  throw new Error('Unsupported PDF payload for printing.');
}

function cleanupTempPath(targetPath) {
  if (!targetPath) return;
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (error) {
    console.warn('Failed to clean up temporary print file:', error);
  }
}

function openNativeContractPreviewWindow(pdfBuffer, pdfFileName) {
  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'submerge-contract-preview-'));
  const pdfPath = path.join(tempDir, pdfFileName);
  fs.writeFileSync(pdfPath, pdfBuffer);
  contractPreviewTempDirs.add(tempDir);

  return shell.openPath(pdfPath).then((errorMessage) => {
    if (errorMessage) {
      contractPreviewTempDirs.delete(tempDir);
      cleanupTempPath(tempDir);
      throw new Error(`Failed to open contract PDF preview: ${errorMessage}`);
    }

    return { success: true };
  });
}

ipcMain.handle('export-breakdown-pdf', async (_, payload) => {
  if (!mainWindow || !mainWindow.webContents) {
    throw new Error('Main window is not available.');
  }
  const filename =
    (payload && typeof payload.filename === 'string' && payload.filename.trim()) ||
    'job-cost-summary-warranty.pdf';
  const { canceled, filePath: selectedPath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Breakdown PDF',
    defaultPath: path.join(app.getPath('downloads'), filename),
    buttonLabel: 'Export PDF',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  });

  if (canceled || !selectedPath) {
    return { canceled: true };
  }

  await mainWindow.webContents.executeJavaScript(
    "document.fonts ? document.fonts.ready.then(() => true) : Promise.resolve(true)"
  );

  const pdfData = await mainWindow.webContents.printToPDF({
    pageSize: 'Letter',
    printBackground: true,
    marginsType: 0,
    margins: {
      top: 0.4,
      bottom: 0.4,
      left: 0.4,
      right: 0.4,
    },
    preferCSSPageSize: false,
    landscape: false,
  });
  const filePath = ensurePdfExtension(selectedPath);
  fs.writeFileSync(filePath, pdfData);
  return { filePath };
});

ipcMain.handle('open-contract-print-preview', async (_, payload) => {
  if (!mainWindow) {
    throw new Error('Main window is not available.');
  }

  const pdfBuffer = toPdfBuffer(payload?.pdfBytes);
  const pdfFileName = sanitizePdfFileName(payload?.fileName, 'contract-print.pdf');

  if (process.platform === 'win32') {
    return openNativeContractPreviewWindow(pdfBuffer, pdfFileName);
  }

  const previewToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  contractPreviewPayloads.set(previewToken, {
    fileName: pdfFileName,
    pdfBytes: Buffer.from(pdfBuffer),
  });

  return new Promise((resolve, reject) => {
    const previewWindow = new BrowserWindow({
      width: 1100,
      height: 1400,
      parent: mainWindow,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      title: 'Contract Print Preview',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload-script.js'),
      },
    });
    previewWindow.removeMenu();
    contractPreviewWindows.add(previewWindow);

    let settled = false;

    const cleanup = () => {
      contractPreviewWindows.delete(previewWindow);
      contractPreviewPayloads.delete(previewToken);
    };

    const fail = (error) => {
      if (!previewWindow.isDestroyed()) {
        previewWindow.destroy();
      }
      cleanup();
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    previewWindow.on('closed', () => {
      cleanup();
    });

    previewWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        console.warn('Ignored contract preview subframe load failure:', errorCode, errorDescription, validatedURL);
        return;
      }
      fail(new Error(`Failed to load contract print preview (${errorCode}): ${errorDescription}`));
    });

    previewWindow.webContents.once('did-finish-load', () => {
      if (previewWindow.isDestroyed()) return;
      previewWindow.show();
      previewWindow.focus();
      if (!settled) {
        settled = true;
        resolve({ success: true });
      }
    });

    previewWindow.loadURL(
      buildRendererUrl(`/contract-print-preview?previewToken=${encodeURIComponent(previewToken)}`)
    ).catch(fail);
  });
});

ipcMain.handle('get-contract-print-preview-data', async (_, payload) => {
  const previewToken = payload?.previewToken;
  if (!previewToken || typeof previewToken !== 'string') {
    return null;
  }

  const previewPayload = contractPreviewPayloads.get(previewToken);
  if (!previewPayload) {
    return null;
  }

  return {
    fileName: previewPayload.fileName,
    pdfBytes: Array.from(previewPayload.pdfBytes),
  };
});

ipcMain.handle('print-contract-preview-pdf', async (event, payload) => {
  const previewToken = payload?.previewToken;
  if (!previewToken || typeof previewToken !== 'string') {
    throw new Error('Missing contract print preview token.');
  }

  const previewPayload = contractPreviewPayloads.get(previewToken);
  if (!previewPayload) {
    throw new Error('This contract preview is no longer available.');
  }

  const pdfBuffer = Buffer.from(previewPayload.pdfBytes);
  const pdfFileName = sanitizePdfFileName(previewPayload.fileName, 'contract-print.pdf');
  const previewWindow = BrowserWindow.fromWebContents(event.sender);

  const startPrintJob = async () => {
    const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'submerge-contract-print-'));
    const pdfPath = path.join(tempDir, pdfFileName);
    fs.writeFileSync(pdfPath, pdfBuffer);

    return new Promise((resolve, reject) => {
      const printWindow = new BrowserWindow({
        parent: mainWindow || undefined,
        modal: false,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        webPreferences: {
          plugins: true,
        },
      });
      printWindow.removeMenu();

      let settled = false;

      const cleanup = () => {
        cleanupTempPath(tempDir);
      };

      const fail = (error) => {
        if (!printWindow.isDestroyed()) {
          printWindow.destroy();
        }
        cleanup();
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      printWindow.on('closed', () => {
        cleanup();
      });

      printWindow.webContents.once('did-fail-load', (_, errorCode, errorDescription) => {
        fail(new Error(`Failed to load contract PDF for printing (${errorCode}): ${errorDescription}`));
      });

      printWindow.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          if (printWindow.isDestroyed()) return;
          printWindow.webContents.print(
            {
              silent: false,
              printBackground: true,
            },
            (success, errorType) => {
              if (!success && errorType && errorType !== 'Print job canceled') {
                fail(new Error(`Failed to print contract PDF: ${errorType}`));
                return;
              }

              if (!printWindow.isDestroyed()) {
                printWindow.close();
              }
              cleanup();
              if (!settled) {
                settled = true;
                resolve({
                  success,
                  canceled: !success && errorType === 'Print job canceled',
                  errorType: success ? undefined : errorType,
                });
              }
            }
          );
        }, 250);
      });

      printWindow.loadURL(pathToFileURL(pdfPath).toString()).catch(fail);
    });
  };

  if (previewWindow && !previewWindow.isDestroyed()) {
    await new Promise((resolve) => {
      previewWindow.once('closed', resolve);
      previewWindow.close();
    });
  }

  return startPrintJob();
});

// Reference data handlers
ipcMain.handle('get-pool-models', async () => {
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM pool_models').all();
});

ipcMain.handle('get-excavation-rates', async () => {
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM excavation_rates').all();
});

ipcMain.handle('get-plumbing-rates', async () => {
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM plumbing_rates').all();
});

ipcMain.handle('get-tile-rates', async () => {
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM tile_rates').all();
});

ipcMain.handle('get-coping-rates', async () => {
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM coping_rates').all();
});

ipcMain.handle('get-decking-rates', async () => {
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM decking_rates').all();
});

ipcMain.handle('get-equipment-catalog', async () => {
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM equipment_catalog').all();
});

ipcMain.handle('get-water-features-catalog', async () => {
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM water_features_catalog').all();
});

ipcMain.handle('get-finish-rates', async () => {
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM finish_rates').all();
});

ipcMain.handle('get-drainage-rates', async () => {
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM drainage_rates').all();
});

// Franchise + pricing handlers
ipcMain.handle('list-franchises', async () => {
  if (!db) throw new Error('Database not initialized');
  ensureDefaultFranchise();
  return db
    .prepare(
      `SELECT id, name, franchise_code AS franchiseCode, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
       FROM franchises
       ORDER BY name`
    )
    .all();
});

ipcMain.handle('get-active-franchise', async () => {
  return getActiveFranchise();
});

ipcMain.handle('set-active-franchise', async (_, franchiseId) => {
  const targetId = franchiseId || DEFAULT_FRANCHISE_ID;
  return setActiveFranchise(targetId);
});

ipcMain.handle('upsert-franchise', async (_, payload) => {
  if (!db) throw new Error('Database not initialized');
  const franchiseId = payload?.id || DEFAULT_FRANCHISE_ID;
  const name = payload?.name || franchiseId;
  const code = payload?.franchiseCode || payload?.code || franchiseId;
  const isActive = payload?.isActive ? 1 : 0;
  const now = new Date().toISOString();

  const tx = db.transaction((id, displayName, activeFlag, franchiseCode) => {
    db.prepare(
      `INSERT INTO franchises (id, name, franchise_code, is_active, created_at, updated_at)
       VALUES (@id, @name, @code, @is_active, @now, @now)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         franchise_code = excluded.franchise_code,
         updated_at = excluded.updated_at,
         is_active = CASE WHEN excluded.is_active = 1 THEN 1 ELSE franchises.is_active END`
    ).run({ id, name: displayName, code: franchiseCode, is_active: activeFlag, now });

    if (activeFlag) {
      db.prepare('UPDATE franchises SET is_active = 0 WHERE id <> ?').run(id);
      db.prepare('UPDATE franchises SET is_active = 1, updated_at = ? WHERE id = ?').run(now, id);
    }
  });

  tx(franchiseId, name, isActive, code);
  return getActiveFranchise();
});

ipcMain.handle('enter-franchise-code', async (_, payload) => {
  if (!db) throw new Error('Database not initialized');
  const rawCode = payload?.franchiseCode || payload?.code;
  const displayName = payload?.displayName || payload?.userName || 'User';
  if (!rawCode) {
    throw new Error('Franchise code is required');
  }

  // Treat codes ending with "-A" as admin codes for the same franchise
  const adminMatch = String(rawCode).trim().toUpperCase().endsWith('-A');
  const normalizedCode = adminMatch ? String(rawCode).trim().slice(0, -2) : String(rawCode).trim();
  const franchise = getFranchiseByCode(normalizedCode);
  if (!franchise) {
    throw new Error('Invalid franchise code');
  }

  setActiveFranchise(franchise.id);
  return {
    userName: displayName,
    franchiseId: franchise.id,
    franchiseName: franchise.name,
    franchiseCode: franchise.franchiseCode,
    role: adminMatch ? 'admin' : 'designer',
    isActive: true,
  };
});

ipcMain.handle('list-pricing-models', async (_, franchiseId) => {
  if (!db) throw new Error('Database not initialized');
  const targetId = franchiseId || DEFAULT_FRANCHISE_ID;
  return (
    db
      .prepare(
        `SELECT id, name, version, is_default AS isDefault, is_hidden_from_view AS isHiddenFromView, created_at AS createdAt, updated_at AS updatedAt
         FROM franchise_pricing_models
         WHERE franchise_id = ?
         ORDER BY is_default DESC, updated_at DESC`
      )
      .all(targetId) || []
  );
});

ipcMain.handle('load-franchise-pricing', async (_, franchiseId) => {
  if (!db) throw new Error('Database not initialized');
  const targetId = franchiseId || DEFAULT_FRANCHISE_ID;
  ensureFranchiseExists(targetId);

  const model = getDefaultPricingModel(targetId);
  if (!model) {
    return null;
  }

  let pricing = null;
  try {
    pricing = model.pricingJson ? JSON.parse(model.pricingJson) : null;
  } catch (error) {
    console.warn('Failed to parse pricing JSON for franchise', targetId, error);
  }

  return {
    franchiseId: targetId,
    version: model.version,
    pricing,
    updatedAt: model.updatedAt,
    updatedBy: model.updatedBy,
    pricingModelId: model.id,
    pricingModelName: model.name,
    isDefault: Boolean(model.isDefault),
    isHiddenFromView: Boolean(model.isHiddenFromView),
  };
});

ipcMain.handle('load-pricing-model', async (_, payload) => {
  if (!db) throw new Error('Database not initialized');
  const franchiseId = payload?.franchiseId || DEFAULT_FRANCHISE_ID;
  const modelId = payload?.pricingModelId || payload?.modelId;
  ensureFranchiseExists(franchiseId);

  const model = modelId ? getPricingModelById(franchiseId, modelId) : getDefaultPricingModel(franchiseId);
  if (!model) return null;

  let pricing = null;
  try {
    pricing = model.pricingJson ? JSON.parse(model.pricingJson) : null;
  } catch (error) {
    console.warn('Failed to parse pricing JSON for franchise', franchiseId, error);
  }

  return {
    franchiseId,
    pricingModelId: model.id,
    pricingModelName: model.name,
    isDefault: Boolean(model.isDefault),
    isHiddenFromView: Boolean(model.isHiddenFromView),
    version: model.version,
    pricing,
    updatedAt: model.updatedAt,
    updatedBy: model.updatedBy,
  };
});

ipcMain.handle('save-pricing-model', async (_, payload) => {
  if (!db) throw new Error('Database not initialized');
  const franchiseId = payload?.franchiseId || DEFAULT_FRANCHISE_ID;
  const name = payload?.name || 'New Pricing Model';
  const pricing = payload?.pricing ?? {};
  const version = payload?.version || DEFAULT_PRICING_VERSION;
  const updatedBy = payload?.updatedBy || null;
  const setDefault = Boolean(payload?.setDefault);
  const isHiddenFromView = Boolean(payload?.isHiddenFromView);
  ensureFranchiseExists(franchiseId, payload?.franchiseName, payload?.franchiseCode || DEFAULT_FRANCHISE_CODE);

  const now = new Date().toISOString();
  const createNew = Boolean(payload?.createNew);
  const id = createNew ? `${franchiseId}-${Date.now()}` : payload?.pricingModelId || payload?.modelId || `${franchiseId}-${Date.now()}`;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO franchise_pricing_models
       (id, franchise_id, name, version, pricing_json, is_default, is_hidden_from_view, created_at, updated_at, updated_by)
       VALUES (@id, @franchise_id, @name, @version, @pricing_json, @is_default, @is_hidden_from_view, @created_at, @updated_at, @updated_by)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         version = excluded.version,
         pricing_json = excluded.pricing_json,
         is_hidden_from_view = excluded.is_hidden_from_view,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by,
         is_default = CASE WHEN excluded.is_default = 1 THEN 1 ELSE franchise_pricing_models.is_default END`
    ).run({
      id,
      franchise_id: franchiseId,
      name,
      version,
      pricing_json: JSON.stringify(pricing),
      is_default: setDefault ? 1 : 0,
      is_hidden_from_view: isHiddenFromView ? 1 : 0,
      created_at: now,
      updated_at: now,
      updated_by: updatedBy,
    });

    if (setDefault) {
      db.prepare('UPDATE franchise_pricing_models SET is_default = 0 WHERE franchise_id = ? AND id <> ?').run(franchiseId, id);
      db.prepare('UPDATE franchise_pricing_models SET is_default = 1, updated_at = ? WHERE id = ?').run(now, id);
    }
  });

  tx();
  return { franchiseId, pricingModelId: id, updatedAt: now, isDefault: setDefault };
});

ipcMain.handle('set-default-pricing-model', async (_, payload) => {
  if (!db) throw new Error('Database not initialized');
  const franchiseId = payload?.franchiseId || DEFAULT_FRANCHISE_ID;
  const modelId = payload?.pricingModelId || payload?.modelId;
  if (!modelId) throw new Error('pricingModelId is required');

  const exists = db.prepare('SELECT COUNT(*) AS count FROM franchise_pricing_models WHERE franchise_id = ? AND id = ?').get(franchiseId, modelId);
  if (!exists || exists.count === 0) {
    throw new Error('Pricing model not found');
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('UPDATE franchise_pricing_models SET is_default = 0 WHERE franchise_id = ?').run(franchiseId);
    db.prepare('UPDATE franchise_pricing_models SET is_default = 1, updated_at = ? WHERE id = ?').run(now, modelId);
  });
  tx();
  return { franchiseId, pricingModelId: modelId, updatedAt: now };
});

ipcMain.handle('delete-pricing-model', async (_, payload) => {
  if (!db) throw new Error('Database not initialized');
  const franchiseId = payload?.franchiseId || DEFAULT_FRANCHISE_ID;
  const modelId = payload?.pricingModelId || payload?.modelId;
  if (!modelId) throw new Error('pricingModelId is required');

  const row = db
    .prepare('SELECT is_default AS isDefault FROM franchise_pricing_models WHERE franchise_id = ? AND id = ?')
    .get(franchiseId, modelId);
  if (!row) {
    throw new Error('Pricing model not found');
  }
  if (row.isDefault) {
    throw new Error('Cannot delete the default pricing model. Set another model as default first.');
  }

  db.prepare('DELETE FROM franchise_pricing_models WHERE franchise_id = ? AND id = ?').run(franchiseId, modelId);
  return { franchiseId, pricingModelId: modelId };
});

// Auto-updater IPC handlers
ipcMain.handle('check-for-updates', async (_event, payload = {}) => {
  if (isDev) {
    return { message: 'Updates are disabled in development mode' };
  }
  try {
    const autoUpdater = getAutoUpdater();
    if (!autoUpdater) {
      return { message: 'Error checking for updates' };
    }

    const requestedChannel = String(payload?.channel || '').trim().toLowerCase();
    if (requestedChannel) {
      if (!/^(master|franchise-[a-z0-9-]+)$/.test(requestedChannel)) {
        throw new Error('Invalid update channel.');
      }
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: `${UPDATE_DOWNLOAD_BASE}/updates-${requestedChannel}/`,
      });
      autoUpdater.channel = 'latest';
      autoUpdater.allowPrerelease = true;
      autoUpdater.allowDowngrade = false;
      console.log(`Auto-update channel configured: updates-${requestedChannel}`);
    }

    const result = await autoUpdater.checkForUpdates();
    const updateInfo = result?.updateInfo;
    const available = Boolean(updateInfo && updateInfo.version && updateInfo.version !== app.getVersion());

    return { available, updateInfo };
  } catch (error) {
    console.error('Error checking for updates:', error);
    sendUpdateError();
    return { message: 'Error checking for updates' };
  }
});

ipcMain.handle('install-update', async () => {
  if (isDev) {
    return;
  }
  const autoUpdater = getAutoUpdater();
  if (autoUpdater) {
    autoUpdater.quitAndInstall();
  }
});
