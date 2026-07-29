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
        // Vant embeds its icon font as an inline base64 woff2 data URI, so
        // 'data:' must be allowed here or every Vant icon renders as a
        // tofu/garbled glyph (refresh button, radio ticks, etc.).
        fontSrc: ["'self'", 'data:'],
        upgradeInsecureRequests: null,
      },
    },
  };
}

export = { buildHelmetOptions };
