/**
 * backend/config/security.test.ts
 *
 * Unit tests for HTTP security middleware configuration.
 * Run with: node --import tsx --test backend/config/security.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHelmetOptions } from './security';

test('helmet options do not force HTTPS for plain HTTP IP deployments', () => {
  const options = buildHelmetOptions();

  assert.equal(options.contentSecurityPolicy.directives.upgradeInsecureRequests, null);
  assert.equal(options.crossOriginOpenerPolicy, false);
  assert.equal(options.originAgentCluster, false);
});
