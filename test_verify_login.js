const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

process.env.PORT = '8098';

const { app } = require('./index');

function makeRequest(method, pathName, data = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : '';
    const options = {
      hostname: '127.0.0.1',
      port: 8098,
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

async function verifyLoginA() {
  console.log('[TEST] Verifying /api/verify-login with password "a"...\n');

  // Wait 300ms
  await new Promise(r => setTimeout(r, 300));

  // 1. Verify /api/verify-login with password "a"
  const loginRes = await makeRequest('POST', '/api/verify-login', { password: 'a' });
  console.log('[TEST 1] POST /api/verify-login (password: "a"):', loginRes);
  assert.strictEqual(loginRes.status, 200, 'Password "a" should authenticate with status 200');
  assert.strictEqual(loginRes.data.success, true);
  console.log('✓ Test 1 Passed: Password "a" successfully authenticated.\n');

  // 2. Verify invalid password
  const failRes = await makeRequest('POST', '/api/verify-login', { password: 'invalid_pass' });
  console.log('[TEST 2] POST /api/verify-login (invalid password):', failRes);
  assert.strictEqual(failRes.status, 401);
  assert.strictEqual(failRes.data.success, false);
  console.log('✓ Test 2 Passed: Invalid password rejected with 401.\n');

  // 3. Verify /api/board-info
  const infoRes = await makeRequest('GET', '/api/board-info');
  console.log('[TEST 3] GET /api/board-info:', infoRes.data);
  assert.strictEqual(infoRes.status, 200);
  assert.strictEqual(infoRes.data.boardType, 'AVDB');
  assert.strictEqual(infoRes.data.platformNo, '1');
  assert.strictEqual(infoRes.data.boardIp, '10.0.0.81');
  assert.strictEqual(infoRes.data.lastTestStatus, 'ALL OK (0 Fault)');
  assert.strictEqual(infoRes.data.adminPasswordHash, undefined, 'adminPasswordHash must not be exposed');
  console.log('✓ Test 3 Passed: /api/board-info returns AVDB telemetry without password hash.\n');

  // 4. Verify board_config.json structure on disk is strictly flat
  const configPath = path.join(__dirname, 'data', 'board_config.json');
  const diskData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('[TEST 4] Disk board_config.json keys:', Object.keys(diskData));
  assert.strictEqual(diskData.data, undefined, 'Must NOT contain nested "data" key');
  assert.strictEqual(diskData.success, undefined, 'Must NOT contain nested "success" key');
  assert.strictEqual(diskData.boardType, 'AVDB');
  assert.strictEqual(diskData.adminPasswordHash, '$2b$10$p.q5HneFh4t7FSqrVBntM.9TJ1BS79Lu1gDfNmES1NS6t3euuVbnK');
  console.log('✓ Test 4 Passed: board_config.json is strictly a flat JSON object.\n');

  console.log('======================================================');
  console.log('  ALL LOGIN & FLAT JSON CHECKS PASSED! (4/4)           ');
  console.log('======================================================');
  process.exit(0);
}

verifyLoginA().catch(err => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
