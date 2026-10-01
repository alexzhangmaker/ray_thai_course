/**
 * SideApp Communication Protocol Constants & Utilities
 * Specification: SideApp Protocol v1.0
 */

export const PROTOCOL_VERSION = '1.0';

export const MESSAGE_TYPES = {
  WELCOME: 'session.welcome',
  RENDER_FULL: 'render.full',
  RENDER_PATCH: 'render.patch',
  RENDER_NAVIGATE: 'render.navigate',
  RENDER_EFFECT: 'render.effect',
  PING: 'ping',
  PONG: 'pong',
  ERROR: 'session.error'
};

export const ERROR_CODES = {
  MASTER_CLOSED: 'MASTER_CLOSED',
  AUTH_FAILED: 'AUTH_FAILED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  INVALID_PROTOCOL: 'INVALID_PROTOCOL',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD'
};

/**
 * Creates a standard message envelope.
 * @param {string} type 
 * @param {object} payload 
 * @param {number} seq 
 * @returns {object} Standard envelope
 */
export function createEnvelope(type, payload = {}, seq = 0) {
  return {
    seq: Number(seq) || 0,
    type,
    protocolVersion: PROTOCOL_VERSION,
    timestamp: Date.now(),
    payload: payload || {}
  };
}

/**
 * Validates whether an incoming object is a compliant protocol envelope.
 * @param {any} envelope 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return { valid: false, error: 'Envelope must be an object' };
  }

  if (typeof envelope.type !== 'string' || !envelope.type) {
    return { valid: false, error: 'Missing or invalid "type"' };
  }

  // Version check (allow major version match)
  const incomingVer = envelope.protocolVersion ? String(envelope.protocolVersion).split('.')[0] : '';
  const currentMajor = PROTOCOL_VERSION.split('.')[0];
  if (incomingVer && incomingVer !== currentMajor) {
    return { valid: false, error: `Incompatible protocol version: ${envelope.protocolVersion} (expected ${PROTOCOL_VERSION})` };
  }

  return { valid: true };
}

/**
 * Lightweight deep difference calculator generating JSON patch-like operations.
 * Returns an array of operations: [{ path: 'key.subkey', value: any }]
 * Returns empty array if no differences are detected.
 * @param {any} prev 
 * @param {any} next 
 * @param {string} prefix 
 * @returns {Array<{ path: string, value: any }>}
 */
export function computePatch(prev, next, prefix = '') {
  const ops = [];

  if (prev === next) {
    return ops;
  }

  // Primitive types or null/undefined comparisons
  if (
    prev === null || prev === undefined ||
    next === null || next === undefined ||
    typeof prev !== 'object' || typeof next !== 'object'
  ) {
    ops.push({ path: prefix, value: next });
    return ops;
  }

  // Handle Date
  if (prev instanceof Date || next instanceof Date) {
    if (String(prev) !== String(next)) {
      ops.push({ path: prefix, value: next });
    }
    return ops;
  }

  // Handle Arrays
  if (Array.isArray(prev) || Array.isArray(next)) {
    if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) {
      ops.push({ path: prefix, value: next });
      return ops;
    }

    // Compare array elements
    let arrayChanged = false;
    for (let i = 0; i < prev.length; i++) {
      const itemOps = computePatch(prev[i], next[i], `${prefix}[${i}]`);
      if (itemOps.length > 0) {
        arrayChanged = true;
        break;
      }
    }

    if (arrayChanged) {
      ops.push({ path: prefix, value: next });
    }
    return ops;
  }

  // Handle Objects
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  const allKeys = new Set([...prevKeys, ...nextKeys]);

  for (const key of allKeys) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (!(key in next)) {
      // Key removed
      ops.push({ path: keyPath, value: undefined });
    } else if (!(key in prev)) {
      // Key added
      ops.push({ path: keyPath, value: next[key] });
    } else {
      const nestedOps = computePatch(prev[key], next[key], keyPath);
      ops.push(...nestedOps);
    }
  }

  return ops;
}

/**
 * Parses path string (e.g. 'a.b.c' or 'items[2].text') into key segments.
 * @param {string} path 
 * @returns {string[]}
 */
export function parsePath(path) {
  if (!path) return [];
  // Match property names and array indices: 'a.b[0].c' -> ['a', 'b', '0', 'c']
  return String(path)
    .replace(/\[(\w+)\]/g, '.$1')
    .replace(/^\./, '')
    .split('.')
    .filter(Boolean);
}

/**
 * Sets a value on a target object at the specified path.
 * Mutates target in-place and returns target.
 * @param {object} target 
 * @param {string} path 
 * @param {any} value 
 * @returns {object}
 */
export function setByPath(target, path, value) {
  if (!path || target === null || target === undefined) {
    return value !== undefined ? value : target;
  }

  const segments = parsePath(path);
  if (segments.length === 0) {
    return value;
  }

  let curr = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const nextSeg = segments[i + 1];

    if (curr[seg] === null || curr[seg] === undefined || typeof curr[seg] !== 'object') {
      // If next segment is numeric index, create array, else object
      const isNextNumeric = /^\d+$/.test(nextSeg);
      curr[seg] = isNextNumeric ? [] : {};
    }
    curr = curr[seg];
  }

  const lastSeg = segments[segments.length - 1];
  if (value === undefined) {
    if (Array.isArray(curr) && /^\d+$/.test(lastSeg)) {
      curr.splice(Number(lastSeg), 1);
    } else {
      delete curr[lastSeg];
    }
  } else {
    curr[lastSeg] = value;
  }

  return target;
}
