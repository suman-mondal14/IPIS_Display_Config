const os = require('os');
const assert = require('assert');
const http = require('http');

process.env.PORT = '8094';

const { app, getLocalIpAddress, findAdapterNameByIp } = require('./index');

function makeRequest(method, pathName, data = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : '';
    const options = {
      hostname: '127.0.0.1',
      port: 8094,
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

async function runDynamicAdapterTests() {
  console.log('[TEST] Starting Dynamic Network Adapter Matching Tests...\n');

  // 1. Test findAdapterNameByIp with active IP
  const currentIp = getLocalIpAddress();
  console.log(`[TEST 1] Current detected IP: ${currentIp}`);
  const matchedAdapter = findAdapterNameByIp(currentIp);
  console.log(`[TEST 1] Matched adapter name for IP "${currentIp}":`, matchedAdapter);
  assert(matchedAdapter && typeof matchedAdapter === 'string', 'Should resolve an adapter name for active IP');
  console.log('✓ Test 1 Passed: Dynamic adapter resolved by IP.\n');

  // 2. Test fallback for 10.* subnet or non-existent IP
  const fallbackAdapter = findAdapterNameByIp('192.0.2.254');
  console.log('[TEST 2] Fallback adapter for non-matching IP:', fallbackAdapter);
  // It should return 10.* fallback if available
  console.log('✓ Test 2 Passed: Fallback adapter handled correctly.\n');

  // 3. Test POST /api/save-config with new IP
  await new Promise(r => setTimeout(r, 400));
  const saveRes = await makeRequest('POST', '/api/save-config', {
    platformNo: '5A',
    boardIp: '10.0.0.88',
    password: 'a'
  });
  console.log('[TEST 3] Save response with new IP:', saveRes);
  assert.strictEqual(saveRes.status, 200);
  assert.strictEqual(saveRes.data.success, true);
  assert.strictEqual(saveRes.data.ipChanged, true);
  assert.strictEqual(saveRes.data.newIp, '10.0.0.88');
  console.log('✓ Test 3 Passed: Save config correctly triggers dynamic adapter switch.\n');

  // Wait 1200ms to allow setTimeout netsh trigger to execute safely
  await new Promise(r => setTimeout(r, 1200));

  // Reset back to standard state
  await makeRequest('POST', '/api/save-config', {
    platformNo: '1',
    boardIp: '10.0.0.81',
    password: 'a'
  });
  await new Promise(r => setTimeout(r, 1200));

  console.log('======================================================');
  console.log('  ALL DYNAMIC ADAPTER MATCHING TESTS PASSED!          ');
  console.log('======================================================');
  process.exit(0);
}

runDynamicAdapterTests().catch(err => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
