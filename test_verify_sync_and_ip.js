const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

process.env.PORT = '8095';

const { app } = require('./index');

function makeRequest(method, pathName, data = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : '';
    const options = {
      hostname: '127.0.0.1',
      port: 8095,
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
  console.log('[TEST] Starting CDC Sync-Back & Static IP Switch Tests...\n');

  // Wait 300ms for boot
  await new Promise(r => setTimeout(r, 300));

  // 1. Check Login
  const loginRes = await makeRequest('POST', '/api/verify-login', { password: 'a' });
  console.log('[TEST 1] Login:', loginRes);
  assert.strictEqual(loginRes.status, 200);
  assert.strictEqual(loginRes.data.success, true);
  console.log('✓ Test 1 Passed: Login verified.\n');

  // 2. Save Config with wrong password
  const failSave = await makeRequest('POST', '/api/save-config', {
    platformNo: '3',
    boardIp: '10.0.0.81',
    password: 'wrong_password'
  });
  console.log('[TEST 2] Wrong password save:', failSave);
  assert.strictEqual(failSave.status, 401);
  assert.strictEqual(failSave.data.success, false);
  console.log('✓ Test 2 Passed: Wrong password rejected.\n');

  // 3. Save Config with same IP (ipChanged: false)
  const sameIpSave = await makeRequest('POST', '/api/save-config', {
    platformNo: '3A',
    boardIp: '10.0.0.81',
    password: 'a'
  });
  console.log('[TEST 3] Same IP save response:', sameIpSave);
  assert.strictEqual(sameIpSave.status, 200);
  assert.strictEqual(sameIpSave.data.success, true);
  assert.strictEqual(sameIpSave.data.ipChanged, false);
  console.log('✓ Test 3 Passed: Same IP save correctly returned ipChanged: false.\n');

  // 4. Save Config with new IP (ipChanged: true)
  const newIpSave = await makeRequest('POST', '/api/save-config', {
    platformNo: '4B',
    boardIp: '10.0.0.85',
    password: 'a'
  });
  console.log('[TEST 4] New IP save response:', newIpSave);
  assert.strictEqual(newIpSave.status, 200);
  assert.strictEqual(newIpSave.data.success, true);
  assert.strictEqual(newIpSave.data.ipChanged, true);
  assert.strictEqual(newIpSave.data.newIp, '10.0.0.85');
  console.log('✓ Test 4 Passed: New IP save correctly returned ipChanged: true and newIp.\n');

  // 5. Verify Disk Cache was saved as flat JSON
  const configPath = path.join(__dirname, 'data', 'board_config.json');
  const diskData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('[TEST 5] Persisted disk config:', diskData);
  assert.strictEqual(diskData.platformNo, '4B');
  assert.strictEqual(diskData.boardIp, '10.0.0.85');
  assert.strictEqual(diskData.data, undefined, 'Must not contain nested data');
  assert.strictEqual(diskData.success, undefined, 'Must not contain nested success');
  console.log('✓ Test 5 Passed: Configuration persisted cleanly to disk.\n');

  // Reset back to standard test state (10.0.0.81, platform 1)
  await makeRequest('POST', '/api/save-config', {
    platformNo: '1',
    boardIp: '10.0.0.81',
    password: 'a'
  });

  console.log('======================================================');
  console.log('  ALL CONFIG, CDC SYNC & IP SWITCH TESTS PASSED!      ');
  console.log('======================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
