/**
 * backend/config/security.js - HTTP security middleware configuration
 */

function buildHelmetOptions() {
  return {
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
  };
}

module.exports = {
  buildHelmetOptions,
};
