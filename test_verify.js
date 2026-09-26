const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

process.env.PORT = '8099';
process.env.CDC_URL = 'http://10.0.0.253:20000';

const { app, getLocalIpAddress } = require('./index');

function makeRequest(method, pathName, data = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : '';
    const options = {
      hostname: '127.0.0.1',
      port: 8099,
      path: pathName,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('[TEST] Starting IPIS Display Config Verification Tests...\n');

  // 1. Dynamic IP Resolution
  const detectedIp = getLocalIpAddress();
  console.log(`[TEST 1] Dynamic IP detected: ${detectedIp}`);
  assert(typeof detectedIp === 'string' && detectedIp.length > 0, 'IP resolution failed');
  console.log('✓ Test 1 Passed: Dynamic IP resolved.\n');

  // Wait 500ms for server to boot
  await new Promise(r => setTimeout(r, 500));

  // 2. Check persistent cache creation
  const configPath = path.join(__dirname, 'data', 'board_config.json');
  assert(fs.existsSync(configPath), 'data/board_config.json must exist');
  const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert(diskConfig.boardType, 'boardType must be present in config');
  assert(diskConfig.adminPasswordHash, 'adminPasswordHash must be present in config');
  console.log('✓ Test 2 Passed: Persistent cache created and validated on disk.\n');

  // 3. Test /api/board-info
  const boardInfoRes = await makeRequest('GET', '/api/board-info');
  console.log('[TEST 3] GET /api/board-info response:', boardInfoRes.data);
  assert.strictEqual(boardInfoRes.status, 200);
  assert.strictEqual(boardInfoRes.data.adminPasswordHash, undefined, 'CRITICAL: adminPasswordHash must NEVER be exposed via API');
  assert.strictEqual(boardInfoRes.data.boardType, diskConfig.boardType);
  assert(boardInfoRes.data.lastTestStatus, 'lastTestStatus should be present');
  console.log('✓ Test 3 Passed: /api/board-info returned sanitized data (no password hash exposed).\n');

  // 4. Test /api/verify-login with invalid password
  const failLoginRes = await makeRequest('POST', '/api/verify-login', { password: 'wrongPassword123' });
  console.log('[TEST 4] POST /api/verify-login (wrong password):', failLoginRes);
  assert.strictEqual(failLoginRes.status, 401);
  assert.strictEqual(failLoginRes.data.success, false);
  assert.strictEqual(failLoginRes.data.message, 'Invalid OEM Password! Access Denied.');
  console.log('✓ Test 4 Passed: Unauthorized login rejected with 401.\n');

  // 5. Test /api/verify-login with valid OEM password (admin123)
  const okLoginRes = await makeRequest('POST', '/api/verify-login', { password: 'admin123' });
  console.log('[TEST 5] POST /api/verify-login (valid password):', okLoginRes);
  assert.strictEqual(okLoginRes.status, 200);
  assert.strictEqual(okLoginRes.data.success, true);
  console.log('✓ Test 5 Passed: Authorized login successfully verified.\n');

  // 6. Test /api/save-config with wrong password
  const failSaveRes = await makeRequest('POST', '/api/save-config', {
    platformNo: '3B',
    boardIp: '10.15.1.100',
    password: 'badPassword'
  });
  console.log('[TEST 6] POST /api/save-config (wrong password):', failSaveRes);
  assert.strictEqual(failSaveRes.status, 401);
  console.log('✓ Test 6 Passed: Unauthorized save rejected.\n');

  // 7. Test /api/save-config with correct password
  const okSaveRes = await makeRequest('POST', '/api/save-config', {
    platformNo: '4A',
    boardIp: '10.12.0.45',
    password: 'admin123'
  });
  console.log('[TEST 7] POST /api/save-config (valid password):', okSaveRes);
  assert.strictEqual(okSaveRes.status, 200);
  assert.strictEqual(okSaveRes.data.success, true);

  // Check updated cache on disk
  const updatedDiskConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.strictEqual(updatedDiskConfig.platformNo, '4A');
  assert.strictEqual(updatedDiskConfig.boardIp, '10.12.0.45');
  console.log('✓ Test 7 Passed: Save config persisted to data/board_config.json.\n');

  // 8. Test /api/board-info reflects new values
  const updatedInfoRes = await makeRequest('GET', '/api/board-info');
  assert.strictEqual(updatedInfoRes.data.platformNo, '4A');
  assert.strictEqual(updatedInfoRes.data.boardIp, '10.12.0.45');
  console.log('✓ Test 8 Passed: GET /api/board-info reflects updated parameters.\n');

  console.log('======================================================');
  console.log('  ALL VERIFICATION TESTS PASSED SUCCESSFULLY! (8/8)   ');
  console.log('======================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
