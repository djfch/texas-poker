const test = require('node:test');
const assert = require('node:assert/strict');

const { buildHelmetOptions } = require('./security');

test('helmet options do not force HTTPS for plain HTTP IP deployments', () => {
  const options = buildHelmetOptions();

  assert.equal(options.contentSecurityPolicy.directives.upgradeInsecureRequests, null);
  assert.equal(options.crossOriginOpenerPolicy, false);
  assert.equal(options.originAgentCluster, false);
});
