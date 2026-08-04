const { contextBridge, ipcRenderer } = require('electron');
// Prefer the version supplied by the main process to avoid bundle path issues
const appVersion = process.env.SUBMERGE_APP_VERSION || process.env.npm_package_version || 'dev';
// Expose env so renderer can read Supabase config even when import.meta.env is unavailable
contextBridge.exposeInMainWorld('__APP_ENV__', {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
  VITE_SUPABASE_ONLY: process.env.VITE_SUPABASE_ONLY,
});

const setIpcListener = (channel, callback) => {
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, (_, payload) => callback(payload));
};

contextBridge.exposeInMainWorld('electron', {
  // App info
  appVersion,
  // Proposal operations
  saveProposal: (proposal) => ipcRenderer.invoke('save-proposal', proposal),
  getProposal: (proposalNumber) => ipcRenderer.invoke('get-proposal', proposalNumber),
  getAllProposals: () => ipcRenderer.invoke('get-all-proposals'),
  getAllProposalsWithReport: () => ipcRenderer.invoke('get-all-proposals-with-report'),
  deleteProposal: (proposalNumber) => ipcRenderer.invoke('delete-proposal', proposalNumber),
  openProposalsFolder: () => ipcRenderer.invoke('open-proposals-folder'),
  readChangelog: (payload) => ipcRenderer.invoke('read-changelog', payload),

  // Listen for opening proposals from file system
  onOpenProposal: (callback) => setIpcListener('open-proposal', callback),

  // Reference data
  getPoolModels: () => ipcRenderer.invoke('get-pool-models'),
  getExcavationRates: () => ipcRenderer.invoke('get-excavation-rates'),
  getPlumbingRates: () => ipcRenderer.invoke('get-plumbing-rates'),
  getTileRates: () => ipcRenderer.invoke('get-tile-rates'),
  getCopingRates: () => ipcRenderer.invoke('get-coping-rates'),
  getDeckingRates: () => ipcRenderer.invoke('get-decking-rates'),
  getEquipmentCatalog: () => ipcRenderer.invoke('get-equipment-catalog'),
  getWaterFeaturesCatalog: () => ipcRenderer.invoke('get-water-features-catalog'),
  getFinishRates: () => ipcRenderer.invoke('get-finish-rates'),
  getDrainageRates: () => ipcRenderer.invoke('get-drainage-rates'),

  // Export
  exportBreakdownPdf: (payload) => ipcRenderer.invoke('export-breakdown-pdf', payload),
  openContractPrintPreview: (payload) => ipcRenderer.invoke('open-contract-print-preview', payload),
  getContractPrintPreviewData: (payload) => ipcRenderer.invoke('get-contract-print-preview-data', payload),
  printContractPreviewPdf: (payload) => ipcRenderer.invoke('print-contract-preview-pdf', payload),

  // Franchise + pricing
  listFranchises: () => ipcRenderer.invoke('list-franchises'),
  upsertFranchise: (franchise) => ipcRenderer.invoke('upsert-franchise', franchise),
  getActiveFranchise: () => ipcRenderer.invoke('get-active-franchise'),
  setActiveFranchise: (franchiseId) => ipcRenderer.invoke('set-active-franchise', franchiseId),
  loadFranchisePricing: (franchiseId) => ipcRenderer.invoke('load-franchise-pricing', franchiseId),
  loadPricingModel: (payload) => ipcRenderer.invoke('load-pricing-model', payload),
  listPricingModels: (franchiseId) => ipcRenderer.invoke('list-pricing-models', franchiseId),
  savePricingModel: (payload) => ipcRenderer.invoke('save-pricing-model', payload),
  setDefaultPricingModel: (payload) => ipcRenderer.invoke('set-default-pricing-model', payload),
  deletePricingModel: (payload) => ipcRenderer.invoke('delete-pricing-model', payload),
  saveFranchisePricing: (payload) => ipcRenderer.invoke('save-pricing-model', payload), // backward compatibility alias
  enterFranchiseCode: (payload) => ipcRenderer.invoke('enter-franchise-code', payload),

  // Update operations
  checkForUpdates: (payload) => ipcRenderer.invoke('check-for-updates', payload),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (callback) => setIpcListener('update-available', callback),
  onUpdateNotAvailable: (callback) => setIpcListener('update-not-available', callback),
  onDownloadProgress: (callback) => setIpcListener('download-progress', callback),
  onUpdateDownloaded: (callback) => setIpcListener('update-downloaded', callback),
  onUpdateError: (callback) => setIpcListener('update-error', callback),
});
