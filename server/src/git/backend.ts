import { spawn } from 'node:child_process';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { repoPath } from './repos.js';

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
  // Express puts the matched tail into req.params via the route pattern.
  // We also accept a generic fallthrough so the path is always reconstructable.
  const repoName = req.params.repo as string;
  const subPath = (req.params[0] as string) || '';

  // Reconstruct PATH_INFO the way git-http-backend expects:
  //   /<repo>.git/<sub-path>
  const pathInfo = `/${repoName}.git/${subPath}`.replace(/\/+$/, '');

  // CGI variables required by git-http-backend.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_PROJECT_ROOT: config.reposDir,
    GIT_HTTP_EXPORT_ALL: '1',
    // Allow push to non-bare too, and permit receiving into the current branch.
    // Our repos are bare, but this keeps things lenient.
    REQUEST_METHOD: req.method,
    PATH_INFO: pathInfo,
    QUERY_STRING: req.url.split('?')[1] || '',
    CONTENT_TYPE: req.headers['content-type'] || '',
    CONTENT_LENGTH: String(req.headers['content-length'] || ''),
    REMOTE_ADDR: req.ip || '',
    REMOTE_USER: (req as any).remoteUser || '',
    GIT_HTTP_BACKEND_OVERRIDE_RECEIVE_PACK: '1',
    // Ask git to stream large packs without buffering.
    GIT_PROTOCOL: (req.headers['git-protocol'] as string) || '',
    HTTP_GIT_PROTOCOL: (req.headers['git-protocol'] as string) || '',
    GATEWAY_INTERFACE: 'CGI/1.1',
    SERVER_PROTOCOL: 'HTTP/1.1',
  };

  const child = spawn('git', ['http-backend'], { env });

  // Pipe the raw request body into the backend's stdin.
  req.pipe(child.stdin);

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
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`git http-backend failed to start: ${err.message}`);
    }
  });

  child.on('exit', () => {
    // nothing — response already ended via stdout 'end'
  });

  // If the client disconnects, tear down the backend.
  req.on('close', () => {
    child.kill();
  });
}
