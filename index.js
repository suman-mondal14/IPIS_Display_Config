const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { exec } = require('child_process');

const PORT = parseInt(process.env.PORT || '80', 10);
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'board_config.json');
const CDC_BASE_URL = process.env.CDC_URL || 'http://10.0.0.253:20000';
const SYNC_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * Find active network adapter interface name matching the specified IP address or subnet
 */
function findAdapterNameByIp(targetIp) {
  const interfaces = os.networkInterfaces();
  
  // 1. Direct exact IP match
  if (targetIp) {
    for (const name of Object.keys(interfaces)) {
      const addresses = interfaces[name] || [];
      for (const iface of addresses) {
        if (iface.family === 'IPv4' && !iface.internal && iface.address === targetIp) {
          return name;
        }
      }
    }
  }

  // 2. Match current detected physical IP
  const currentPhysicalIp = getLocalIpAddress();
  if (currentPhysicalIp && currentPhysicalIp !== '127.0.0.1') {
    for (const name of Object.keys(interfaces)) {
      const addresses = interfaces[name] || [];
      for (const iface of addresses) {
        if (iface.family === 'IPv4' && !iface.internal && iface.address === currentPhysicalIp) {
          return name;
        }
      }
    }
  }

  // 3. Subnet prefix match (e.g. 10.0.0.x)
  if (targetIp && targetIp.includes('.')) {
    const targetSubnet = targetIp.split('.').slice(0, 3).join('.') + '.';
    for (const name of Object.keys(interfaces)) {
      const addresses = interfaces[name] || [];
      for (const iface of addresses) {
        if (iface.family === 'IPv4' && !iface.internal && iface.address.startsWith(targetSubnet)) {
          return name;
        }
      }
    }
  }

  // 4. Any 10.* railway network interface
  for (const name of Object.keys(interfaces)) {
    const addresses = interfaces[name] || [];
    for (const iface of addresses) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address.startsWith('10.')) {
        return name;
      }
    }
  }

  // 5. Fallback to first non-internal interface
  for (const name of Object.keys(interfaces)) {
    const addresses = interfaces[name] || [];
    for (const iface of addresses) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return name;
      }
    }
  }

  return null;
}

/**
 * Set Windows OS Static IP address via netsh on dynamically detected adapter
 */
function setWindowsStaticIp(newIp, oldIp, subnetMask = "255.255.255.0", gateway = "10.0.0.1") {
  const adapterName = findAdapterNameByIp(oldIp);

  if (!adapterName) {
    console.error(`[NETSH ERROR] Unable to resolve network adapter for IP: ${oldIp}. Available interfaces:`, Object.keys(os.networkInterfaces()));
    return false;
  }

  console.log(`[NETSH INFO] Dynamically resolved adapter "${adapterName}" for current IP ${oldIp}. Changing physical IP to ${newIp}...`);

  const cmd = `netsh interface ipv4 set address name="${adapterName}" static ${newIp} ${subnetMask} ${gateway}`;
  console.log(`[NETSH EXEC] Executing: ${cmd}`);

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error(`[NETSH ERROR] Interface "${adapterName}":`, stderr || err.message);
      if ((stderr || err.message).includes('elevation') || (stderr || err.message).includes('administrator')) {
        console.error('--------------------------------------------------------------------------------');
        console.error(' [ELEVATION REQUIRED] Windows blocked network adapter reconfiguration!');
        console.error(' To allow changing physical IP addresses on Windows, you must run Node.js as Administrator:');
        console.error(' Right-click Command Prompt / PowerShell -> "Run as administrator" -> npm start');
        console.error('--------------------------------------------------------------------------------');
      }
    } else {
      console.log(`[NETSH SUCCESS] Interface "${adapterName}" physical IP successfully changed to ${newIp} (Mask: ${subnetMask}, GW: ${gateway})`);
    }
  });

  return true;
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Dynamic Self-IP Resolution
 * Priority: IPv4 starting with railway subnet '10.' -> Any non-internal IPv4 -> '127.0.0.1'
 */
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  let fallbackIp = null;

  for (const interfaceName of Object.keys(interfaces)) {
    const addresses = interfaces[interfaceName] || [];
    for (const iface of addresses) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (iface.address.startsWith('10.')) {
          return iface.address;
        }
        if (!fallbackIp) {
          fallbackIp = iface.address;
        }
      }
    }
  }

  return fallbackIp || '127.0.0.1';
}

// In-memory active configuration
let activeConfig = null;
let lastSyncTimestamp = null;
let lastSyncStatus = 'INITIALIZING';

/**
 * Generate default fallback board configuration
 */
function generateDefaultConfig(detectedIp) {
  const salt = bcrypt.genSaltSync(10);
  const defaultPasswordHash = bcrypt.hashSync('admin123', salt);

  return {
    boardType: 'PDBD',
    platformNo: '1',
    boardIp: detectedIp,
    adminPasswordHash: defaultPasswordHash,
    lastTestStatus: 'PASSED (All LEDs OK)',
    lastTestTime: 'N/A'
  };
}

/**
 * Load persistent configuration from disk or create default
 */
function loadLocalConfig() {
  const detectedIp = getLocalIpAddress();

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const rawData = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(rawData);
      console.log(`[Config Engine] Loaded local persistent cache from ${CONFIG_FILE}`);
      
      // Unwrap if legacy nested object exists
      const src = (parsed.data && typeof parsed.data === 'object') ? parsed.data : parsed;

      activeConfig = {
        boardType: src.boardType || 'PDBD',
        platformNo: String(src.platformNo !== undefined ? src.platformNo : '1'),
        boardIp: src.boardIp || detectedIp,
        adminPasswordHash: src.adminPasswordHash || parsed.adminPasswordHash,
        lastTestStatus: src.lastTestStatus || 'PASSED (All LEDs OK)',
        lastTestTime: src.lastTestTime || 'N/A'
      };

      return activeConfig;
    } catch (err) {
      console.error(`[Config Engine] Error reading cache file: ${err.message}. Generating fresh default.`);
    }
  }

  activeConfig = generateDefaultConfig(detectedIp);
  saveConfigToDisk(activeConfig);
  console.log(`[Config Engine] Initialized default configuration with detected IP: ${detectedIp}`);
  return activeConfig;
}

/**
 * Persist active configuration to disk as a flat JSON object
 */
function saveConfigToDisk(config) {
  try {
    const flatConfig = {
      boardType: config.boardType || 'PDBD',
      platformNo: String(config.platformNo !== undefined ? config.platformNo : '1'),
      boardIp: config.boardIp || getLocalIpAddress(),
      adminPasswordHash: config.adminPasswordHash,
      lastTestStatus: config.lastTestStatus || 'PASSED (All LEDs OK)',
      lastTestTime: config.lastTestTime || 'N/A'
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(flatConfig, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`[Config Engine] Failed to save configuration to disk: ${err.message}`);
    return false;
  }
}

/**
 * Sync configuration from Central Data Controller (CDC) Master
 */
async function syncFromCDC() {
  const detectedIp = activeConfig ? activeConfig.boardIp : getLocalIpAddress();
  const cdcEndpoint = `${CDC_BASE_URL}/api/display-board/config?boardIp=${encodeURIComponent(detectedIp)}`;

  try {
    console.log(`[CDC Sync] Contacting Central Data Controller at ${cdcEndpoint}...`);
    const response = await axios.get(cdcEndpoint, { timeout: 3500 });

    if (response.status === 200 && response.data) {
      // Extract data if response is { success: true, data: { ... } } or direct { ... }
      const remoteData = (response.data && response.data.data && typeof response.data.data === 'object') 
        ? response.data.data 
        : response.data;
      console.log('[CDC Sync] Master configuration fetched successfully from CDC.');

      // Overwrite/merge only at root level of the JSON object without nesting data or success
      activeConfig = {
        boardType: remoteData.boardType || activeConfig.boardType || 'PDBD',
        platformNo: remoteData.platformNo !== undefined ? String(remoteData.platformNo) : activeConfig.platformNo,
        boardIp: remoteData.boardIp || activeConfig.boardIp || detectedIp,
        adminPasswordHash: remoteData.adminPasswordHash || activeConfig.adminPasswordHash,
        lastTestStatus: remoteData.lastTestStatus || activeConfig.lastTestStatus || 'PASSED (All LEDs OK)',
        lastTestTime: remoteData.lastTestTime || activeConfig.lastTestTime || 'N/A'
      };

      saveConfigToDisk(activeConfig);
      lastSyncTimestamp = new Date().toISOString();
      lastSyncStatus = 'CONNECTED_SYNCED';
    } else {
      lastSyncStatus = `UNEXPECTED_STATUS_${response.status}`;
    }
  } catch (err) {
    lastSyncTimestamp = new Date().toISOString();
    lastSyncStatus = 'OFFLINE_FALLBACK';
    console.warn(`[CDC Sync] CDC Offline/Unreachable (${CDC_BASE_URL}). Retaining persistent local cache. Reason: ${err.message}`);
  }
}

// Initial configuration load
loadLocalConfig();

// Initialize CDC Boot Sync
syncFromCDC().catch(() => {});

// Background Periodic CDC Sync every 30 seconds
setInterval(() => {
  syncFromCDC().catch(() => {});
}, SYNC_INTERVAL_MS);

// Create Express Server
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * POST /api/verify-login
 * Body: { password }
 */
app.post('/api/verify-login', (req, res) => {
  const { password } = req.body;

  if (!password || typeof password !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Password is required'
    });
  }

  if (!activeConfig || !activeConfig.adminPasswordHash) {
    return res.status(500).json({
      success: false,
      message: 'Server configuration error: password hash missing.'
    });
  }

  const isMatch = bcrypt.compareSync(password, activeConfig.adminPasswordHash);

  if (isMatch) {
    return res.json({
      success: true,
      message: 'Authentication successful. OEM access granted.'
    });
  } else {
    return res.status(401).json({
      success: false,
      message: 'Invalid OEM Password! Access Denied.'
    });
  }
});

/**
 * GET /api/board-info
 * Returns sanitized board information (never exposes adminPasswordHash)
 */
app.get('/api/board-info', (req, res) => {
  if (!activeConfig) {
    return res.status(500).json({
      success: false,
      message: 'Configuration not loaded'
    });
  }

  const {
    boardType = 'PDBD',
    platformNo = '1',
    boardIp = getLocalIpAddress(),
    lastTestStatus = 'PASSED (All LEDs OK)',
    lastTestTime = new Date().toISOString(),
    firmwareVersion = 'RDSO-SPN-TC-108-v2.4'
  } = activeConfig;

  res.json({
    boardType,
    platformNo,
    boardIp,
    lastTestStatus,
    lastTestTime,
    firmwareVersion,
    uptime: Math.floor(process.uptime()),
    cdcSyncStatus: lastSyncStatus,
    lastSyncTime: lastSyncTimestamp,
    networkDetectedIp: getLocalIpAddress()
  });
});

/**
 * POST /api/save-config
 * Body: { platformNo, boardIp, password, newPassword? }
 */
app.post('/api/save-config', async (req, res) => {
  const { platformNo, boardIp, password, newPassword } = req.body;

  if (!password || typeof password !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Administrator password required to save changes.'
    });
  }

  const isMatch = bcrypt.compareSync(password, activeConfig.adminPasswordHash);
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: 'Invalid OEM Password! Access Denied.'
    });
  }

  if (!platformNo || !boardIp) {
    return res.status(400).json({
      success: false,
      message: 'Platform Number and Board IP are required fields.'
    });
  }

  const physicalIp = getLocalIpAddress();
  const oldConfigIp = activeConfig.boardIp || physicalIp;
  const targetIp = String(boardIp).trim();
  const targetPlatformNo = String(platformNo).trim();
  const syncOldIp = (physicalIp && physicalIp !== '127.0.0.1') ? physicalIp : oldConfigIp;

  // Send update notification to CDC Master
  try {
    console.log(`[CDC Sync-Back] Notifying CDC at ${CDC_BASE_URL}/api/display-board/update-config...`);
    await axios.post(`${CDC_BASE_URL}/api/display-board/update-config`, {
      oldIp: syncOldIp,
      newIp: targetIp,
      platformNo: targetPlatformNo,
      boardType: activeConfig.boardType || 'PDBD'
    }, { timeout: 3500 });
    console.log('[CDC Sync-Back] Configuration update acknowledged by CDC Master.');
  } catch (cdcErr) {
    console.warn(`[CDC Sync-Back Warning] Could not push update to CDC (${cdcErr.message}). Continuing local save.`);
  }

  // Update in-memory configuration
  activeConfig.platformNo = targetPlatformNo;
  activeConfig.boardIp = targetIp;

  // Optional new password update
  if (newPassword && typeof newPassword === 'string' && newPassword.trim().length >= 4) {
    const salt = bcrypt.genSaltSync(10);
    activeConfig.adminPasswordHash = bcrypt.hashSync(newPassword.trim(), salt);
  }

  const saved = saveConfigToDisk(activeConfig);
  if (!saved) {
    return res.status(500).json({
      success: false,
      message: 'Failed to write configuration to persistent cache storage.'
    });
  }

  console.log(`[Config Engine] Configuration updated: Platform ${activeConfig.platformNo}, IP ${activeConfig.boardIp}`);

  // IP changed if targetIp is different from current physical IP OR from previous cached IP
  const ipChanged = (targetIp !== physicalIp || targetIp !== oldConfigIp);

  if (ipChanged) {
    // Schedule static IP switch after 1000ms to allow HTTP response to flush
    setTimeout(() => {
      setWindowsStaticIp(targetIp, syncOldIp);
    }, 1000);

    return res.json({
      success: true,
      ipChanged: true,
      newIp: targetIp,
      message: 'Configuration saved. Switching board IP...'
    });
  } else {
    return res.json({
      success: true,
      ipChanged: false,
      message: 'Configuration updated successfully.'
    });
  }
});

// Start Express Server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('=====================================================');
  console.log('  TOPGRIP IPIS - EMBEDDED CONFIG & DIAGNOSTIC SERVER');
  console.log('  RDSO SPN/TC/108 Specification Compliant');
  console.log('=====================================================');
  console.log(`  [STATUS] Server running on http://0.0.0.0:${PORT}`);
  console.log(`  [NET-IP] Dynamic Resolved Board IP: ${getLocalIpAddress()}`);
  console.log(`  [CONFIG] Persistent Storage: ${CONFIG_FILE}`);
  console.log(`  [CDC]    Master Sync Target: ${CDC_BASE_URL}`);
  console.log('=====================================================');
});

server.on('error', (err) => {
  if (err.code === 'EACCES' || err.code === 'EADDRINUSE') {
    console.warn(`[Port Notice] Port ${PORT} busy or restricted. Attempting fallback port 8080...`);
    app.listen(8080, '0.0.0.0', () => {
      console.log(`[Fallback Server] Server running on http://0.0.0.0:8080`);
    });
  } else {
    console.error(`[Server Error] ${err.message}`);
  }
});

module.exports = { 
  app, 
  getLocalIpAddress, 
  loadLocalConfig, 
  generateDefaultConfig, 
  findAdapterNameByIp, 
  setWindowsStaticIp 
};
