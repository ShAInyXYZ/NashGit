import { spawn } from 'node:child_process';
import type { Request, Response } from 'express';
import { config } from '../config.js';

/**
 * Handle a git smart-HTTP request by spawning `git http-backend` as a CGI
 * child process and piping the raw request/response streams through it.
 *
 * git-http-backend reads CGI environment variables (REQUEST_METHOD, PATH_INFO,
 * QUERY_STRING, CONTENT_TYPE, GIT_PROJECT_ROOT, ...) from its environment,
 * reads the request body from stdin, and writes the HTTP response (headers +
 * body) to stdout. We parse the CGI headers it emits and forward the rest as
 * the response body.
 *
 * Reference: https://git-scm.com/docs/git-http-backend
 */
export function handleGitRequest(req: Request, res: Response): void {
  // This handler is mounted under /git, so req.url is the path *within* that
  // mount point — e.g. "/test-backup.git/info/refs". That's exactly the
  // PATH_INFO that git-http-backend expects (relative to GIT_PROJECT_ROOT).
  const pathInfo = req.url.split('?')[0].replace(/\/+$/, '') || '/';

  // CGI variables required by git-http-backend.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_PROJECT_ROOT: config.reposDir,
    GIT_HTTP_EXPORT_ALL: '1',
    REQUEST_METHOD: req.method,
    PATH_INFO: pathInfo,
    QUERY_STRING: req.url.split('?')[1] || '',
    CONTENT_TYPE: req.headers['content-type'] || '',
    CONTENT_LENGTH: String(req.headers['content-length'] || ''),
    REMOTE_ADDR: req.ip || '',
    REMOTE_USER: (req as any).remoteUser || '',
    GIT_PROTOCOL: (req.headers['git-protocol'] as string) || '',
    HTTP_GIT_PROTOCOL: (req.headers['git-protocol'] as string) || '',
    GATEWAY_INTERFACE: 'CGI/1.1',
    SERVER_PROTOCOL: 'HTTP/1.1',
  };

  const child = spawn('git', ['http-backend'], { env });

  // Surface git-http-backend errors to the server log (it normally writes
  // diagnostics to stderr, not stdout).
  child.stderr.on('data', (chunk: Buffer) => {
    const msg = chunk.toString('utf8').trimEnd();
    if (msg) console.error('[git-http-backend]', msg);
  });

  // Pipe the raw request body into the backend's stdin, and close stdin when
  // the request ends so git-http-backend sees EOF (critical for GET requests
  // which have no body — without this the backend hangs waiting for input).
  req.pipe(child.stdin, { end: true });
  req.on('end', () => {
    if (!child.stdin.destroyed) child.stdin.end();
  });
  // Safety net: if the request errors, tear down the child.
  req.on('error', () => child.kill());

  // git-http-backend writes a CGI response: headers, a blank line, then body.
  // We buffer until we've seen the header/body separator, then stream the body.
  let headersBuffer = Buffer.alloc(0);
  let headerSepFound = false;
  let status = 200;
  const headers: { name: string; value: string }[] = [];

  child.stdout.on('data', (chunk: Buffer) => {
    if (headerSepFound) {
      res.write(chunk);
      return;
    }
    headersBuffer = Buffer.concat([headersBuffer, chunk]);
    const sep = Buffer.from('\r\n\r\n');
    const idx = headersBuffer.indexOf(sep);
    if (idx === -1) {
      // also accept single-LF separators (some git versions)
      const lfSep = Buffer.from('\n\n');
      const lfIdx = headersBuffer.indexOf(lfSep);
      if (lfIdx === -1) return;
      const headerBlock = headersBuffer.subarray(0, lfIdx).toString('utf8');
      parseCgiHeaders(headerBlock);
      res.writeHead(status, Object.fromEntries(headers.map((h) => [h.name, h.value])));
      const body = headersBuffer.subarray(lfIdx + 2);
      headerSepFound = true;
      if (body.length) res.write(body);
      return;
    }
    const headerBlock = headersBuffer.subarray(0, idx).toString('utf8');
    parseCgiHeaders(headerBlock);
    res.writeHead(status, Object.fromEntries(headers.map((h) => [h.name, h.value])));
    const body = headersBuffer.subarray(idx + 4);
    headerSepFound = true;
    if (body.length) res.write(body);
  });

  function parseCgiHeaders(block: string) {
    for (const line of block.split(/\r?\n/)) {
      if (!line) continue;
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const name = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (name.toLowerCase() === 'status') {
        const m = value.match(/^(\d{3})/);
        if (m) status = Number(m[1]);
      } else {
        headers.push({ name, value });
      }
    }
  }

  child.stdout.on('end', () => {
    if (!headerSepFound && headersBuffer.length) {
      // No separator ever arrived — send what we have as a raw response.
      res.writeHead(status, { 'Content-Type': 'text/plain' });
      res.write(headersBuffer);
    }
    res.end();
  });

  child.on('error', (err) => {
    console.error('[nashgit] git http-backend error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`git http-backend failed to start: ${err.message}`);
    }
  });

  // If the client disconnects mid-transfer (response not finished), tear down
  // the backend so we don't leak a process. Only kill if the response hasn't
  // completed — `res.writableEnded` is true once res.end() has been called.
  res.on('close', () => {
    if (!res.writableEnded) child.kill();
  });
}
