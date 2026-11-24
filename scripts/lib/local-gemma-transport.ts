/**
 * USCT-024 (Optional): Node 24 HTTP/HTTPS & Merlin Loopback Tunnel Transport
 * Enforces bounded config/credential reads, loopback TLS verification, and bearer scrubbing.
 */

import { execFile } from 'node:child_process';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { existsSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { err, ok, type Result } from '@civic-source/types';
import type { LocalModelBudgetRecord } from './workbench-catalog.js';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_LOCAL_CONFIG_BYTES = 1024 * 1024;
const execFileAsync = promisify(execFile);

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface MerlinChatCompletionBody { model: string; messages: ChatMessage[]; stream: false; max_tokens: number }
export type LocalModelBudgetStatus = LocalModelBudgetRecord['status'];
export type LocalModelFailureKind =
  | 'gateway_unavailable' | 'rate_limited' | 'cancelled' | 'budget_exhausted'
  | 'malformed_response' | 'policy_rejected' | 'auth_error' | 'invalid_config'
  | 'unsafe_path' | 'transport_error';

export class LocalModelAdapterError extends Error {
  readonly kind: LocalModelFailureKind;
  readonly budgetStatus: LocalModelBudgetStatus;
  readonly httpStatus?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    kind: LocalModelFailureKind,
    message: string,
    opts?: { httpStatus?: number; retryAfterSeconds?: number; secrets?: readonly (string | undefined)[] }
  ) {
    super(redactSecrets(message, opts?.secrets ?? []));
    this.name = 'LocalModelAdapterError';
    this.kind = kind;
    this.budgetStatus =
      kind === 'gateway_unavailable' || kind === 'rate_limited' || kind === 'cancelled' || kind === 'budget_exhausted'
        ? kind : 'failed';
    if (opts?.httpStatus !== undefined) this.httpStatus = opts.httpStatus;
    if (opts?.retryAfterSeconds !== undefined) this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

export interface MerlinClientConfig {
  configPath: string; gatewayHost: string; gatewayPort: number; caFile: string; tokenFile: string;
  defaultModel: string; timeoutSeconds: number; capabilitiesFile?: string;
  declaredModelWeightsDigest?: string; declaredNumCtx?: number;
}
export interface LocalModelTransportRequest { body: MerlinChatCompletionBody; bodyJson: string; timeoutMs: number; signal?: AbortSignal }
export interface LocalModelTransportResponse { statusCode: number; headers: Record<string, string | string[] | undefined>; rawBody: string }
export type LocalModelTransport = (req: LocalModelTransportRequest) => Promise<Result<LocalModelTransportResponse, LocalModelAdapterError>>;

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const expandHome = (p: string): string =>
  p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;

/** Scrub Authorization headers and explicit secret literals from logs and receipts. */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[] = []): string {
  let clean = text
    .replace(/authorization\s*:\s*bearer\s+[^\s"',;]+/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]');
  for (const s of secrets) if (s && s.length > 0) clean = clean.split(s).join('[REDACTED]');
  return clean;
}

async function readBoundedUtf8(filePath: string, maxBytes: number): Promise<Result<string, LocalModelAdapterError>> {
  try {
    const resolved = resolve(expandHome(filePath));
    const stats = await lstat(resolved);
    if (stats.isSymbolicLink() || !stats.isFile()) return err(new LocalModelAdapterError('invalid_config', `Expected regular non-symlink file: ${resolved}`));
    if (stats.size > maxBytes) return err(new LocalModelAdapterError('budget_exhausted', `File exceeds ${maxBytes} byte limit: ${resolved}`));
    return ok(await readFile(resolved, 'utf-8'));
  } catch (e: unknown) {
    return err(new LocalModelAdapterError('invalid_config', `Cannot read file ${filePath}: ${e instanceof Error ? e.message : String(e)}`));
  }
}

async function readCapabilitiesProfile(
  capabilitiesFile: string | undefined,
  alias: string
): Promise<{ declaredModelWeightsDigest?: string; declaredNumCtx?: number }> {
  if (!capabilitiesFile) return {};
  const raw = await readBoundedUtf8(capabilitiesFile, MAX_LOCAL_CONFIG_BYTES);
  if (!raw.ok) return {};
  try {
    const capJson: unknown = JSON.parse(raw.value);
    const prof = isPlainObject(capJson) && isPlainObject(capJson.profiles) ? capJson.profiles[alias] : undefined;
    if (!isPlainObject(prof)) return {};
    return {
      ...(typeof prof.manifest_sha256 === 'string' ? { declaredModelWeightsDigest: `sha256:${prof.manifest_sha256}` } : {}),
      ...(typeof prof.context_tokens === 'number' && Number.isInteger(prof.context_tokens) ? { declaredNumCtx: prof.context_tokens } : {}),
    };
  } catch {
    return {};
  }
}

/** Load and validate Merlin client configuration without embedding token material. */
export async function loadMerlinClientConfig(options?: {
  configPath?: string; caFile?: string; tokenFile?: string; modelAlias?: string; defaultModelFallback?: string;
}): Promise<Result<MerlinClientConfig, LocalModelAdapterError>> {
  const configPath = resolve(expandHome(options?.configPath ?? '~/.config/merlin-agent/config.json'));
  const rawRes = await readBoundedUtf8(configPath, MAX_LOCAL_CONFIG_BYTES);
  if (!rawRes.ok) return rawRes;
  let parsed: unknown;
  try { parsed = JSON.parse(rawRes.value); } catch {
    return err(new LocalModelAdapterError('invalid_config', `Malformed JSON in Merlin config: ${configPath}`));
  }
  if (!isPlainObject(parsed) || (parsed.schema_version !== undefined && parsed.schema_version !== 1)) {
    return err(new LocalModelAdapterError('invalid_config', 'Merlin config must be a schema_version 1 object'));
  }
  const gatewayHost = typeof parsed.gateway_host === 'string' ? parsed.gateway_host : '';
  const gatewayPort = parsed.gateway_port === undefined ? 11435 : parsed.gateway_port;
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(gatewayHost) || typeof gatewayPort !== 'number' || !Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65535) {
    return err(new LocalModelAdapterError('invalid_config', 'Merlin config has invalid gateway_host or gateway_port'));
  }
  const caFile = expandHome(options?.caFile ?? (typeof parsed.ca_file === 'string' ? parsed.ca_file : ''));
  const tokenFile = expandHome(options?.tokenFile ?? (typeof parsed.token_file === 'string' ? parsed.token_file : ''));
  if (!caFile || !tokenFile) return err(new LocalModelAdapterError('invalid_config', 'Merlin config requires ca_file and token_file'));
  const defaultModel = typeof parsed.default_model === 'string' ? parsed.default_model : (options?.defaultModelFallback ?? 'merlin-gemma4');
  const timeoutSeconds = typeof parsed.timeout_seconds === 'number' && parsed.timeout_seconds >= 1 && parsed.timeout_seconds <= 900 ? parsed.timeout_seconds : 360;
  const capabilitiesFile = typeof parsed.capabilities_file === 'string' ? expandHome(parsed.capabilities_file) : undefined;
  const profileMeta = await readCapabilitiesProfile(capabilitiesFile, options?.modelAlias ?? defaultModel);
  return ok({
    configPath, gatewayHost, gatewayPort, caFile, tokenFile, defaultModel, timeoutSeconds,
    ...(capabilitiesFile !== undefined ? { capabilitiesFile } : {}), ...profileMeta,
  });
}

function attachResponseListeners(
  req: http.ClientRequest,
  secrets: readonly string[],
  signal: AbortSignal | undefined,
  finish: (outcome: Result<LocalModelTransportResponse, LocalModelAdapterError>) => void
): void {
  req.on('response', (res) => {
    const chunks: Buffer[] = [];
    let total = 0;
    res.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_RESPONSE_BYTES) {
        req.destroy();
        finish(err(new LocalModelAdapterError('budget_exhausted', 'Response exceeded 8 MiB limit', { secrets })));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => finish(ok({ statusCode: res.statusCode ?? 500, headers: res.headers, rawBody: Buffer.concat(chunks).toString('utf-8') })));
    res.on('error', (e) => finish(err(new LocalModelAdapterError('transport_error', e.message, { secrets }))));
  });
  req.on('error', (e) => finish(err(new LocalModelAdapterError(signal?.aborted ? 'cancelled' : 'gateway_unavailable', e.message, { secrets }))));
}

function executeNodeHttp(opts: {
  protocol: 'http:' | 'https:'; hostname: string; port: number; path: string; bodyJson: string;
  token?: string; caPem?: string; servername?: string; useLoopbackLookup?: boolean; signal?: AbortSignal; secrets: readonly string[];
}): Promise<Result<LocalModelTransportResponse, LocalModelAdapterError>> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (outcome: Result<LocalModelTransportResponse, LocalModelAdapterError>) => {
      if (!settled) { settled = true; resolvePromise(outcome); }
    };
    const lookupFn = (host: string, lOpts: LookupOptions, cb: (e: NodeJS.ErrnoException | null, addr: string | LookupAddress[], fam?: number) => void): void => {
      if (host !== opts.hostname) { cb(new Error('Unconfigured destination hostname'), ''); return; }
      cb(null, lOpts.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1', 4);
    };
    const reqOpts: https.RequestOptions = {
      hostname: opts.hostname, port: opts.port, path: opts.path, method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        'Content-Length': String(Buffer.byteLength(opts.bodyJson, 'utf-8')),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.caPem ? { ca: opts.caPem } : {}),
      ...(opts.servername ? { servername: opts.servername } : {}), ...(opts.useLoopbackLookup ? { lookup: lookupFn } : {}),
    };
    const req = opts.protocol === 'https:' ? https.request(reqOpts) : http.request(reqOpts);
    attachResponseListeners(req, opts.secrets, opts.signal, finish);
    req.write(opts.bodyJson, 'utf-8');
    req.end();
  });
}

async function resolveBearerToken(opts: {
  token?: string; tokenEnv?: string; tokenFile?: string; required: boolean;
}): Promise<Result<string | undefined, LocalModelAdapterError>> {
  if (opts.token?.trim()) return ok(opts.token.trim());
  if (opts.tokenEnv && process.env[opts.tokenEnv]?.trim()) return ok(process.env[opts.tokenEnv]!.trim());
  if (opts.tokenFile) {
    const res = await readBoundedUtf8(opts.tokenFile, 1024);
    if (!res.ok) return res;
    if (!res.value.trim()) return err(new LocalModelAdapterError('invalid_config', 'Token file is empty'));
    return ok(res.value.trim());
  }
  return opts.required ? err(new LocalModelAdapterError('auth_error', 'Merlin bearer token is required')) : ok(undefined);
}

/** Build an HTTP/HTTPS transport for an explicit OpenAI-compatible endpoint URL. */
export async function createEndpointTransport(opts: {
  endpoint: string; caFile?: string; token?: string; tokenEnv?: string; tokenFile?: string;
}): Promise<Result<{ transport: LocalModelTransport; secrets: string[] }, LocalModelAdapterError>> {
  let url: URL;
  try { url = new URL(opts.endpoint); } catch { return err(new LocalModelAdapterError('invalid_config', 'Invalid --endpoint URL')); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return err(new LocalModelAdapterError('invalid_config', 'Endpoint URL must use http or https'));
  const tokenRes = await resolveBearerToken({
    ...(opts.token ? { token: opts.token } : {}), ...(opts.tokenEnv ? { tokenEnv: opts.tokenEnv } : {}), ...(opts.tokenFile ? { tokenFile: opts.tokenFile } : {}), required: false,
  });
  if (!tokenRes.ok) return tokenRes;
  if (tokenRes.value && url.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
    return err(new LocalModelAdapterError('invalid_config', 'Refusing bearer token over cleartext HTTP to non-loopback host'));
  }
  const caRes = opts.caFile ? await readBoundedUtf8(opts.caFile, MAX_LOCAL_CONFIG_BYTES) : ok(undefined);
  if (!caRes.ok) return caRes;
  const pathName = url.pathname.endsWith('/chat/completions') ? url.pathname : `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  const secrets = tokenRes.value ? [tokenRes.value] : [];
  return ok({
    secrets,
    transport: (req) => executeNodeHttp({
      protocol: url.protocol as 'http:' | 'https:', hostname: url.hostname, port, path: `${pathName}${url.search}`,
      bodyJson: req.bodyJson, secrets,
      ...(tokenRes.value !== undefined ? { token: tokenRes.value } : {}),
      ...(caRes.value !== undefined ? { caPem: caRes.value } : {}),
      ...(req.signal !== undefined ? { signal: req.signal } : {}),
    }),
  });
}

async function openMerlinTunnelPort(configPath: string, merlinBin?: string, signal?: AbortSignal): Promise<Result<number, LocalModelAdapterError>> {
  const defaultBin = join(homedir(), '.local/share/merlin-agent/current/bin/merlin-agent');
  const bin = merlinBin ?? (existsSync(defaultBin) ? defaultBin : 'merlin-agent');
  try {
    const { stdout } = await execFileAsync(bin, ['--config', configPath, 'connect'], {
      timeout: 20_000, maxBuffer: 1024 * 1024, ...(signal ? { signal } : {}),
    });
    const parsed: unknown = JSON.parse(stdout);
    if (!isPlainObject(parsed) || typeof parsed.port !== 'number' || !Number.isInteger(parsed.port) || parsed.port < 1024 || parsed.port > 65535) {
      return err(new LocalModelAdapterError('gateway_unavailable', 'merlin-agent connect returned invalid tunnel port'));
    }
    return ok(parsed.port);
  } catch (e: unknown) {
    if (signal?.aborted) return err(new LocalModelAdapterError('cancelled', 'Request cancelled by caller'));
    return err(new LocalModelAdapterError('gateway_unavailable', `merlin-agent connect failed: ${e instanceof Error ? e.message : String(e)}`));
  }
}

/** Establish an owned loopback SSH forward via merlin-agent and verify TLS against ca_file. */
export async function createMerlinTransport(
  merlinCfg: MerlinClientConfig,
  opts?: { merlinBin?: string; caFile?: string; token?: string; tokenEnv?: string; tokenFile?: string; signal?: AbortSignal }
): Promise<Result<{ transport: LocalModelTransport; secrets: string[] }, LocalModelAdapterError>> {
  const tokenRes = await resolveBearerToken({
    ...(opts?.token ? { token: opts.token } : {}), ...(opts?.tokenEnv ? { tokenEnv: opts.tokenEnv } : {}),
    tokenFile: opts?.tokenFile ?? merlinCfg.tokenFile, required: true,
  });
  if (!tokenRes.ok) return tokenRes;
  const caRes = await readBoundedUtf8(opts?.caFile ?? merlinCfg.caFile, MAX_LOCAL_CONFIG_BYTES);
  if (!caRes.ok) return caRes;
  const tunnelRes = await openMerlinTunnelPort(merlinCfg.configPath, opts?.merlinBin, opts?.signal);
  if (!tunnelRes.ok) return tunnelRes;
  const secrets = tokenRes.value ? [tokenRes.value] : [];
  return ok({
    secrets,
    transport: (req) => executeNodeHttp({
      protocol: 'https:', hostname: merlinCfg.gatewayHost, port: tunnelRes.value, path: '/v1/chat/completions',
      bodyJson: req.bodyJson, caPem: caRes.value, servername: merlinCfg.gatewayHost, useLoopbackLookup: true, secrets,
      ...(tokenRes.value !== undefined ? { token: tokenRes.value } : {}),
      ...(req.signal !== undefined ? { signal: req.signal } : {}),
    }),
  });
}
