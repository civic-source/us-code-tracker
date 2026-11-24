/**
 * USCT-024 (Optional): Node 24 HTTP/HTTPS Endpoint & Merlin Agent CLI Transport
 * Enforces descriptor-based bounded reads (O_NOFOLLOW), delegates Merlin TLS/token auth
 * to `merlin-agent`, and scrubs bearer secrets from errors and receipts.
 */

import { execFile } from 'node:child_process';
import { constants as fsConstants, existsSync } from 'node:fs';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { homedir, tmpdir } from 'node:os';
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
  const resolved = resolve(expandHome(filePath));
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Open once with O_NOFOLLOW and inspect the opened descriptor to avoid path-based TOCTOU races.
    handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stats = await handle.stat();
    if (!stats.isFile() || stats.nlink !== 1) {
      return err(new LocalModelAdapterError('invalid_config', `Expected regular single-link file: ${resolved}`));
    }
    if (stats.size > maxBytes) {
      return err(new LocalModelAdapterError('budget_exhausted', `File exceeds ${maxBytes} byte limit: ${resolved}`));
    }
    const buf = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buf.length) {
      const { bytesRead } = await handle.read(buf, offset, buf.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) {
      return err(new LocalModelAdapterError('budget_exhausted', `File exceeds ${maxBytes} byte limit: ${resolved}`));
    }
    return ok(buf.subarray(0, offset).toString('utf-8'));
  } catch (e: unknown) {
    return err(new LocalModelAdapterError('invalid_config', `Cannot read file ${filePath}: ${e instanceof Error ? e.message : String(e)}`));
  } finally {
    await handle?.close();
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

/** Load and validate Merlin client metadata without embedding token material. */
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
  token?: string; signal?: AbortSignal; secrets: readonly string[];
}): Promise<Result<LocalModelTransportResponse, LocalModelAdapterError>> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (outcome: Result<LocalModelTransportResponse, LocalModelAdapterError>) => {
      if (!settled) { settled = true; resolvePromise(outcome); }
    };
    const reqOpts: https.RequestOptions = {
      hostname: opts.hostname, port: opts.port, path: opts.path, method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        'Content-Length': String(Buffer.byteLength(opts.bodyJson, 'utf-8')),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    };
    const req = opts.protocol === 'https:' ? https.request(reqOpts) : http.request(reqOpts);
    attachResponseListeners(req, opts.secrets, opts.signal, finish);
    req.write(opts.bodyJson, 'utf-8');
    req.end();
  });
}

function resolveEnvBearerToken(opts: {
  token?: string; tokenEnv?: string;
}): Result<string | undefined, LocalModelAdapterError> {
  if (opts.token?.trim()) return ok(opts.token.trim());
  if (opts.tokenEnv && process.env[opts.tokenEnv]?.trim()) return ok(process.env[opts.tokenEnv]!.trim());
  return ok(undefined);
}

/** Build an HTTP/HTTPS transport for an explicit OpenAI-compatible endpoint URL. */
export async function createEndpointTransport(opts: {
  endpoint: string; caFile?: string; token?: string; tokenEnv?: string; tokenFile?: string;
}): Promise<Result<{ transport: LocalModelTransport; secrets: string[] }, LocalModelAdapterError>> {
  let url: URL;
  try { url = new URL(opts.endpoint); } catch { return err(new LocalModelAdapterError('invalid_config', 'Invalid --endpoint URL')); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return err(new LocalModelAdapterError('invalid_config', 'Endpoint URL must use http or https'));
  if (opts.tokenFile || opts.caFile) {
    return err(new LocalModelAdapterError(
      'invalid_config',
      'Direct --endpoint mode reads bearer tokens only from --token-env (and CA bundles via NODE_EXTRA_CA_CERTS); use --merlin-config for file-backed Merlin credentials'
    ));
  }
  const tokenRes = resolveEnvBearerToken({
    ...(opts.token ? { token: opts.token } : {}), ...(opts.tokenEnv ? { tokenEnv: opts.tokenEnv } : {}),
  });
  if (!tokenRes.ok) return tokenRes;
  if (tokenRes.value && url.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
    return err(new LocalModelAdapterError('invalid_config', 'Refusing bearer token over cleartext HTTP to non-loopback host'));
  }
  const pathName = url.pathname.endsWith('/chat/completions') ? url.pathname : `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname;
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  const secrets = tokenRes.value ? [tokenRes.value] : [];
  return ok({
    secrets,
    transport: (req) => executeNodeHttp({
      protocol: url.protocol as 'http:' | 'https:', hostname, port, path: `${pathName}${url.search}`,
      bodyJson: req.bodyJson, secrets,
      ...(tokenRes.value !== undefined ? { token: tokenRes.value } : {}),
      ...(req.signal !== undefined ? { signal: req.signal } : {}),
    }),
  });
}

function mapMerlinAgentOutput(stdout: string, secrets: readonly string[]): Result<LocalModelTransportResponse, LocalModelAdapterError> {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout.trim()); } catch {
    return err(new LocalModelAdapterError('gateway_unavailable', 'merlin-agent returned non-JSON output', { secrets }));
  }
  if (!isPlainObject(parsed) || typeof parsed.status !== 'string') {
    return err(new LocalModelAdapterError('malformed_response', 'merlin-agent output missing status', { secrets }));
  }
  if (parsed.status === 'cancelled') return err(new LocalModelAdapterError('cancelled', 'Request cancelled by caller', { secrets }));
  if (parsed.status === 'paused') {
    return ok({ statusCode: 503, headers: {}, rawBody: JSON.stringify({ error: isPlainObject(parsed.error) ? parsed.error : { code: 'merlin_paused', message: 'Merlin is paused or unavailable' } }) });
  }
  if ((parsed.status === 'completed' || parsed.status === 'budget_exhausted') && typeof parsed.content === 'string') {
    const finishReason = typeof parsed.finish_reason === 'string' ? parsed.finish_reason : parsed.status === 'budget_exhausted' ? 'length' : 'stop';
    return ok({
      statusCode: 200,
      headers: {},
      rawBody: JSON.stringify({
        id: 'merlin-agent-run',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: parsed.content }, finish_reason: finishReason }],
        usage: {
          ...(typeof parsed.prompt_tokens === 'number' ? { prompt_tokens: parsed.prompt_tokens } : {}),
          ...(typeof parsed.completion_tokens === 'number' ? { completion_tokens: parsed.completion_tokens } : {}),
        },
      }),
    });
  }
  const errObj = isPlainObject(parsed.error) ? parsed.error : undefined;
  const errCode = typeof errObj?.code === 'string' ? errObj.code : '';
  const errMsg = typeof errObj?.message === 'string' ? errObj.message : `merlin-agent returned status ${parsed.status}`;
  if (errCode === 'authentication') return ok({ statusCode: 401, headers: {}, rawBody: JSON.stringify({ error: { code: errCode, message: errMsg } }) });
  if (errCode === 'rate_limited') return ok({ statusCode: 429, headers: {}, rawBody: JSON.stringify({ error: { code: errCode, message: errMsg } }) });
  if (errCode === 'request_incompatible' || errCode === 'output_limit' || errCode === 'profile_not_permitted') {
    return ok({ statusCode: 400, headers: {}, rawBody: JSON.stringify({ error: { code: errCode, message: errMsg } }) });
  }
  const kind = errCode === 'context_limit' || parsed.status === 'budget_exhausted' ? 'budget_exhausted' : 'gateway_unavailable';
  return err(new LocalModelAdapterError(kind, errMsg, { secrets }));
}

async function runMerlinAgentTask(params: {
  bin: string; configPath: string; req: LocalModelTransportRequest; secrets: readonly string[];
}): Promise<Result<LocalModelTransportResponse, LocalModelAdapterError>> {
  const workDir = await mkdtemp(join(tmpdir(), 'usct-merlin-'));
  const taskPath = join(workDir, 'task.json');
  const outDir = join(workDir, 'run');
  try {
    await writeFile(taskPath, JSON.stringify({ schema_version: 1, profile: params.req.body.model, messages: params.req.body.messages }), { encoding: 'utf-8', mode: 0o600 });
    const argv = ['--config', params.configPath, 'run', '--task', taskPath, '--out', outDir, '--model', params.req.body.model, '--max-tokens', String(params.req.body.max_tokens)];
    let stdout = '';
    try {
      const res = await execFileAsync(params.bin, argv, { timeout: params.req.timeoutMs + 5_000, maxBuffer: MAX_RESPONSE_BYTES, ...(params.req.signal ? { signal: params.req.signal } : {}) });
      stdout = res.stdout;
    } catch (e: unknown) {
      if (params.req.signal?.aborted) return err(new LocalModelAdapterError('cancelled', 'Request cancelled by caller', { secrets: params.secrets }));
      const execErr = e as { stdout?: unknown; message?: string; killed?: boolean; code?: unknown };
      if (execErr.killed || execErr.code === 'ETIMEDOUT') {
        return err(new LocalModelAdapterError('budget_exhausted', `merlin-agent exceeded ${params.req.timeoutMs}ms budget`, { secrets: params.secrets }));
      }
      stdout = typeof execErr.stdout === 'string' ? execErr.stdout : '';
      if (!stdout.trim()) {
        return err(new LocalModelAdapterError('gateway_unavailable', `merlin-agent run failed: ${execErr.message ?? String(e)}`, { secrets: params.secrets }));
      }
    }
    return mapMerlinAgentOutput(stdout, params.secrets);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Execute Merlin gateway requests through merlin-agent so tokens and CAs never enter Node HTTP calls. */
export async function createMerlinTransport(
  merlinCfg: MerlinClientConfig,
  opts?: { merlinBin?: string; caFile?: string; token?: string; tokenEnv?: string; tokenFile?: string; signal?: AbortSignal }
): Promise<Result<{ transport: LocalModelTransport; secrets: string[] }, LocalModelAdapterError>> {
  if (opts?.signal?.aborted) return err(new LocalModelAdapterError('cancelled', 'Request cancelled by caller'));
  const secrets = opts?.token ? [opts.token] : [];
  if (opts?.caFile || opts?.tokenFile || opts?.tokenEnv || opts?.token) {
    return err(new LocalModelAdapterError(
      'invalid_config',
      'Merlin mode reads TLS CA and bearer token exclusively via --merlin-config inside merlin-agent; omit --ca-file, --token-file, and --token-env overrides',
      { secrets }
    ));
  }
  const defaultBin = join(homedir(), '.local/share/merlin-agent/current/bin/merlin-agent');
  const bin = opts?.merlinBin ?? (existsSync(defaultBin) ? defaultBin : 'merlin-agent');
  return ok({
    secrets,
    transport: (req) => runMerlinAgentTask({ bin, configPath: merlinCfg.configPath, req, secrets }),
  });
}
