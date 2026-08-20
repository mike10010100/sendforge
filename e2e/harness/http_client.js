/**
 * HTTP Client Helper for Sendforge E2E Testing
 * Supports Dumb HTTP endpoints, CORS checks, RFC 7233 Range requests,
 * loose object fetching, metadata retrieval, and high-concurrency scraper floods.
 */

import http from 'node:http';

export class SendforgeHttpClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async request(path, options = {}) {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const method = options.method || 'GET';
    const headers = options.headers || {};
    const timeout = options.timeout || 10000;

    const res = await fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(timeout)
    });

    const status = res.status;
    const resHeaders = {};
    for (const [k, v] of res.headers.entries()) {
      resHeaders[k.toLowerCase()] = v;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const text = buffer.toString('utf-8');

    return {
      status,
      headers: resHeaders,
      buffer,
      text,
      body: text,
      json: () => {
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error(`Failed to parse JSON response from ${url}:\n${text}`);
        }
      }
    };
  }

  async get(path, headers = {}) {
    return this.request(path, { method: 'GET', headers });
  }

  async head(path, headers = {}) {
    return this.request(path, { method: 'HEAD', headers });
  }

  async options(path, headers = {}) {
    return this.request(path, { method: 'OPTIONS', headers });
  }

  /**
   * Perform RFC 7233 HTTP Range Request
   */
  async getRange(path, start, end = '') {
    const rangeHeader = `bytes=${start}-${end}`;
    return this.request(path, {
      method: 'GET',
      headers: {
        'Range': rangeHeader
      }
    });
  }

  /**
   * Fetch dumb HTTP info/refs
   */
  async getInfoRefs() {
    return this.get('/info/refs');
  }

  /**
   * Fetch repo metadata meta.json
   */
  async getMetaJson() {
    const res = await this.get('/meta.json');
    return { ...res, data: res.json() };
  }

  /**
   * Fetch static index.html fallback
   */
  async getIndexHtml() {
    return this.get('/index.html');
  }

  /**
   * Fetch static log.html fallback
   */
  async getLogHtml() {
    return this.get('/log.html');
  }

  /**
   * Fetch loose Git object /objects/xx/xxx
   */
  async getLooseObject(oid) {
    const prefix = oid.slice(0, 2);
    const suffix = oid.slice(2);
    return this.get(`/objects/${prefix}/${suffix}`);
  }

  /**
   * High-concurrency scraper load flood
   * Issues N requests across C concurrency lanes and measures TTFB, throughput, and errors.
   */
  async flood(endpoints = ['/', '/index.html', '/log.html', '/meta.json', '/info/refs'], totalRequests = 1000, concurrency = 50) {
    const results = {
      total: totalRequests,
      successful: 0,
      failed: 0,
      statusCodes: {},
      latenciesMs: [],
      startTime: Date.now(),
      durationMs: 0
    };

    let sent = 0;
    const worker = async () => {
      while (sent < totalRequests) {
        const reqIdx = sent++;
        const targetPath = endpoints[reqIdx % endpoints.length];
        const reqStart = Date.now();
        try {
          const res = await this.get(targetPath);
          const latency = Date.now() - reqStart;
          results.latenciesMs.push(latency);
          results.statusCodes[res.status] = (results.statusCodes[res.status] || 0) + 1;
          if (res.status >= 200 && res.status < 400) {
            results.successful++;
          } else {
            results.failed++;
          }
        } catch (e) {
          results.failed++;
          results.statusCodes['ERROR'] = (results.statusCodes['ERROR'] || 0) + 1;
        }
      }
    };

    const workers = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
    results.durationMs = Date.now() - results.startTime;

    if (results.latenciesMs.length > 0) {
      results.latenciesMs.sort((a, b) => a - b);
      results.p50Latency = results.latenciesMs[Math.floor(results.latenciesMs.length * 0.50)];
      results.p95Latency = results.latenciesMs[Math.floor(results.latenciesMs.length * 0.95)];
      results.p99Latency = results.latenciesMs[Math.floor(results.latenciesMs.length * 0.99)];
      results.avgLatency = results.latenciesMs.reduce((a, b) => a + b, 0) / results.latenciesMs.length;
    }

    return results;
  }
}
