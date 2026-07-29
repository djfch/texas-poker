/**
 * backend/config/security.ts - HTTP security middleware configuration
 */

interface HelmetOptions {
  crossOriginOpenerPolicy: boolean;
  originAgentCluster: boolean;
  contentSecurityPolicy: {
    directives: {
      defaultSrc: string[];
      scriptSrc: string[];
      styleSrc: string[];
      connectSrc: string[];
      imgSrc: string[];
      fontSrc: string[];
      upgradeInsecureRequests: null;
    };
  };
}

function buildHelmetOptions(): HelmetOptions {
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

export = { buildHelmetOptions };
