import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { neon } from '@neondatabase/serverless';
import { waitUntil } from '@vercel/functions';
import { createCipheriv, createDecipheriv, createHmac, createHash, sign as cryptoSign, pbkdf2, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, '.local');
const DATABASE_FILE = path.join(DATA_DIR, 'finance.sqlite');
const ENCRYPTION_KEY_FILE = path.join(DATA_DIR, 'app-encryption.key');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const BRADESCO_ITEM_FILE = path.join(DATA_DIR, 'bradesco-item.json');
const BROKERAGE_ITEMS_FILE = path.join(DATA_DIR, 'brokerage-items.json');
const PLUGGY_WEBHOOK_STATE_FILE = path.join(DATA_DIR, 'pluggy-webhook-state.json');
const SESSION_COOKIE = 'finance_session';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const CLIENT_DATA_KEYS = new Set([
  'meu-controle-financeiro-transactions-v1', 'meu-controle-financeiro-monthly-income-v1',
  'meu-controle-financeiro-allocation-percentages-v1',
  'meu-controle-financeiro-cards-v1', 'meu-controle-financeiro-fixed-costs-v1',
  'meu-controle-financeiro-investments-v1', 'meu-controle-financeiro-binance-balances-v1',
  'meu-controle-financeiro-bank-balance-overrides-v1'
]);
const DUMMY_PASSWORD_SALT = randomBytes(16);
let pluggyApiKey = '';
let pluggyApiKeyExpiresAt = 0;
let database;
let postgresQuery;
let legacyOwnerId = null;
let dataEncryptionKey;

function postgresPlaceholders(statement) {
  let index = 0;
  return statement.replace(/\?/g, () => `$${++index}`);
}

async function dbGet(statement, ...parameters) {
  if (database) return database.prepare(statement).get(...parameters) || null;
  const rows = await postgresQuery.query(postgresPlaceholders(statement), parameters);
  return rows[0] || null;
}

async function dbAll(statement, ...parameters) {
  if (database) return database.prepare(statement).all(...parameters);
  return await postgresQuery.query(postgresPlaceholders(statement), parameters);
}

async function dbRun(statement, ...parameters) {
  if (database) return database.prepare(statement).run(...parameters);
  return await postgresQuery.query(postgresPlaceholders(statement), parameters);
}

async function dbExec(statement) {
  if (database) return database.exec(statement);
  for (const part of statement.split(';').map(value => value.trim()).filter(Boolean)) await postgresQuery.query(part);
}

async function getUser(userId) {
  return await dbGet('SELECT id, username, email, email_verified_at AS "emailVerifiedAt", salt, password_hash AS hash, recovery_salt AS "recoverySalt", recovery_hash AS "recoveryHash" FROM users WHERE id = ?', userId);
}

async function getUserByUsername(username) {
  return await dbGet('SELECT id, username, email, email_verified_at AS "emailVerifiedAt", salt, password_hash AS hash, recovery_salt AS "recoverySalt", recovery_hash AS "recoveryHash" FROM users WHERE lower(username) = lower(?)', String(username || '').trim());
}

function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function validEmail(value) { return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function emailCodeHash(userId, code) { return createHmac('sha256', dataEncryptionKey).update(`${userId}:${code}`).digest('hex'); }

async function sendMail(to, subject, text) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.EMAIL_FROM || '').trim();
  if (!apiKey || !from) throw Object.assign(new Error('Envio de e-mail indisponível. Configure RESEND_API_KEY e EMAIL_FROM na Vercel.'), { status: 503 });
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    console.error('Falha no envio de e-mail:', response.status, body.name || body.statusCode || 'provider_error');
    throw Object.assign(new Error('Não foi possível enviar o e-mail agora. Confira a configuração do remetente e tente novamente.'), { status: 502 });
  }
}

async function createEmailCode(userId, email, purpose) {
  const code = String(randomInt(0, 100000000)).padStart(8, '0');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const table = purpose === 'verify' ? 'email_verification_codes' : 'password_reset_codes';
  await dbRun(`INSERT INTO ${table} (user_id, email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
    userId, email, emailCodeHash(userId, code), expiresAt, new Date().toISOString());
  return code;
}

async function getUserCount() {
  const row = await dbGet('SELECT COUNT(*) AS count FROM users');
  return Number(row?.count) || 0;
}

async function getUserData(userId, key, fallback = null) {
  const row = await dbGet('SELECT value FROM user_data WHERE user_id = ? AND data_key = ?', userId, key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

async function setUserData(userId, key, value) {
  await dbRun(`INSERT INTO user_data (user_id, data_key, value, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, data_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    userId, key, JSON.stringify(value), new Date().toISOString());
}

async function readBradescoItem(userId) {
  return await getUserData(userId, 'bradesco_item');
}

async function writeBradescoItem(userId, item) {
  await setUserData(userId, 'bradesco_item', item);
}

async function readBrokerageItems(userId) {
  const items = await getUserData(userId, 'brokerage_items', []);
  return Array.isArray(items) ? items : [];
}

async function writeBrokerageItems(userId, items) {
  await setUserData(userId, 'brokerage_items', items);
}

async function getLegacyOwnerId() {
  return (await dbGet('SELECT value FROM app_meta WHERE key = ?', 'legacy_owner_id'))?.value || null;
}

async function readLegacyJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

function encryptSecret(value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataEncryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

function decryptSecret(record) {
  const decipher = createDecipheriv('aes-256-gcm', dataEncryptionKey, Buffer.from(record.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

async function initializeEncryptionKey() {
  const configured = String(process.env.APP_ENCRYPTION_KEY || '').trim();
  if (configured) {
    const key = Buffer.from(configured, 'base64');
    if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY precisa ser uma chave Base64 de 32 bytes.');
    dataEncryptionKey = key;
    return;
  }
  try {
    dataEncryptionKey = await readFile(ENCRYPTION_KEY_FILE);
    if (dataEncryptionKey.length !== 32) throw new Error('Chave de criptografia local inválida. Configure APP_ENCRYPTION_KEY e recupere a chave anterior para ler as credenciais salvas.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    dataEncryptionKey = randomBytes(32);
    await writeFile(ENCRYPTION_KEY_FILE, dataEncryptionKey, { flag: 'wx', mode: 0o600 });
  }
}

async function initializeDatabase() {
  await initializeEncryptionKey();
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (databaseUrl) postgresQuery = neon(databaseUrl);
  else if (process.env.NODE_ENV === 'production') throw new Error('Configure DATABASE_URL com a conexão Neon antes de iniciar em produção.');
  else database = new DatabaseSync(DATABASE_FILE);
  const usernameConstraint = databaseUrl ? '' : ' UNIQUE COLLATE NOCASE';
  await dbExec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL${usernameConstraint},
      email TEXT,
      email_verified_at TEXT,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      recovery_salt TEXT,
      recovery_hash TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_data (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      data_key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, data_key)
    );
    CREATE TABLE IF NOT EXISTS user_secrets (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      secret_name TEXT NOT NULL,
      nonce TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, secret_name)
    );
    CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_rate_limits (
      bucket_key TEXT PRIMARY KEY,
      hit_count INTEGER NOT NULL,
      window_started_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pluggy_webhook_events (
      event_id TEXT PRIMARY KEY,
      received_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_data_updated ON user_data(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS email_verification_codes (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS password_reset_codes (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  for (const column of ['email TEXT', 'email_verified_at TEXT']) {
    try { await dbExec(`ALTER TABLE users ADD COLUMN ${column}`); } catch (error) {
      if (!/already exists|duplicate column/i.test(String(error.message))) throw error;
    }
  }
  await dbExec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email)) WHERE email IS NOT NULL;');
  if (databaseUrl) await dbExec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username));');

  const legacyAuth = await readLegacyJson(AUTH_FILE);
  if (legacyAuth?.username && legacyAuth?.salt && legacyAuth?.hash) {
    let user = await getUserByUsername(legacyAuth.username);
    if (!user) {
      const id = randomUUID();
      await dbRun(`INSERT INTO users (id, username, salt, password_hash, recovery_salt, recovery_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, id, legacyAuth.username, legacyAuth.salt, legacyAuth.hash, legacyAuth.recoverySalt || null, legacyAuth.recoveryHash || null, new Date().toISOString());
      user = await getUserByUsername(legacyAuth.username);
    }
    await dbRun('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', 'legacy_owner_id', user.id);
    legacyOwnerId = await getLegacyOwnerId();
    const legacyBrokerages = await readLegacyJson(BROKERAGE_ITEMS_FILE, {});
    if (Array.isArray(legacyBrokerages?.items) && !await dbGet('SELECT 1 FROM user_data WHERE user_id = ? AND data_key = ?', user.id, 'brokerage_items')) await setUserData(user.id, 'brokerage_items', legacyBrokerages.items);
    const legacyBankItem = await readLegacyJson(BRADESCO_ITEM_FILE);
    if (legacyBankItem && !await getUserData(user.id, 'bradesco_item')) await writeBradescoItem(user.id, legacyBankItem);
    const legacyWebhookState = await readLegacyJson(PLUGGY_WEBHOOK_STATE_FILE);
    if (legacyWebhookState && !await getUserData(user.id, 'pluggy_webhook_state')) await setUserData(user.id, 'pluggy_webhook_state', legacyWebhookState);
    if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET && !await dbGet('SELECT 1 FROM user_secrets WHERE user_id = ? AND secret_name = ?', user.id, 'binance')) {
      await saveUserSecret(user.id, 'binance', JSON.stringify({ apiKey: process.env.BINANCE_API_KEY, apiSecret: process.env.BINANCE_API_SECRET }));
    }
    if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
      try {
        const envPath = path.join(ROOT, '.env');
        const envText = await readFile(envPath, 'utf8');
        const cleaned = envText.split(/\r?\n/).filter(line => !/^\s*BINANCE_API_(?:KEY|SECRET)\s*=/.test(line)).join('\n');
        await writeFile(envPath, cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`, { mode: 0o600 });
      } catch {}
      delete process.env.BINANCE_API_KEY;
      delete process.env.BINANCE_API_SECRET;
    }
  }
  legacyOwnerId = legacyOwnerId || await getLegacyOwnerId();
}

async function saveUserSecret(userId, secretName, value) {
  const encrypted = encryptSecret(value);
  await dbRun(`INSERT INTO user_secrets (user_id, secret_name, nonce, ciphertext, auth_tag, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, secret_name) DO UPDATE SET nonce = excluded.nonce, ciphertext = excluded.ciphertext, auth_tag = excluded.auth_tag, updated_at = excluded.updated_at`,
    userId, secretName, encrypted.nonce, encrypted.ciphertext, encrypted.tag, new Date().toISOString());
}

async function getUserSecret(userId, secretName) {
  const record = await dbGet('SELECT nonce, ciphertext, auth_tag AS tag FROM user_secrets WHERE user_id = ? AND secret_name = ?', userId, secretName);
  return record ? decryptSecret(record) : '';
}

function openFinanceConnectorName(item) {
  return String(item.connector?.name || item.connector?.institution?.name || item.connectorName || '');
}

function supportedOpenFinanceConnector(name) {
  return /bradesco|pluggy\s*bank/i.test(name);
}

function displayOpenFinanceConnector(name) {
  return /pluggy\s*bank/i.test(name) ? 'Pluggy Bank (Sandbox)' : 'Bradesco';
}

async function handleItemCreated(itemId, event) {
  const item = await pluggyRequest(`/items/${encodeURIComponent(itemId)}`);
  const connectorName = openFinanceConnectorName(item);
  if (!supportedOpenFinanceConnector(connectorName)) return;
  const ownerId = String(item.clientUserId || event.clientUserId || '');
  if (!ownerId || !await getUser(ownerId)) return;
  await writeBradescoItem(ownerId, { itemId, connectorName, connectedAt: new Date().toISOString() });
  await setUserData(ownerId, 'pluggy_webhook_state', { eventId: event.eventId, event: event.event, itemId, receivedAt: new Date().toISOString() });
}

async function handleItemUpdated(itemId, event) {
  const item = await pluggyRequest(`/items/${encodeURIComponent(itemId)}`);
  const connectorName = openFinanceConnectorName(item);
  if (!supportedOpenFinanceConnector(connectorName)) return;
  const ownerId = String(item.clientUserId || event.clientUserId || '');
  if (!ownerId || !await getUser(ownerId)) return;
  const saved = await readBradescoItem(ownerId);
  await writeBradescoItem(ownerId, { ...saved, itemId, connectorName, updatedAt: new Date().toISOString() });
  await setUserData(ownerId, 'pluggy_webhook_state', { eventId: event.eventId, event: event.event, itemId, receivedAt: new Date().toISOString() });
}

async function handleItemError(itemId, event) {
  const rawError = event.error;
  const detail = (typeof rawError === 'string' ? rawError : JSON.stringify(rawError || 'Erro não detalhado pela Pluggy.')).replace(/[\r\n\t]/g, ' ').slice(0, 500);
  const ownerId = String(event.clientUserId || '');
  if (ownerId && await getUser(ownerId)) await setUserData(ownerId, 'pluggy_webhook_state', { eventId: event.eventId, event: event.event, itemId, error: detail, receivedAt: new Date().toISOString() });
  console.warn(`Pluggy item error (${String(event.eventId).slice(0, 100)}): ${detail}`);
}

function handlePluggyWebhook(event) {
  switch (event.event) {
    case 'item/created': return handleItemCreated(event.itemId, event);
    case 'item/updated': return handleItemUpdated(event.itemId, event);
    case 'item/error': return handleItemError(event.itemId, event);
    default: return Promise.resolve();
  }
}

function matchesWebhookSecret(received, expected) {
  const left = Buffer.from(String(received || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

async function getPluggyApiKey() {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const error = new Error('Configure PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no arquivo .env do servidor.');
    error.status = 503;
    throw error;
  }
  if (pluggyApiKey && pluggyApiKeyExpiresAt > Date.now() + 60_000) return pluggyApiKey;
  let response;
  try {
    response = await fetch('https://api.pluggy.ai/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret }), signal: AbortSignal.timeout(15000), cache: 'no-store'
    });
  } catch {
    const error = new Error('Não foi possível alcançar a autenticação Pluggy. Verifique a conexão do servidor.');
    error.status = 502;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.apiKey) {
    const error = new Error(`A autenticação Pluggy foi recusada (HTTP ${response.status}). Confira as credenciais de desenvolvedor.`);
    error.status = response.status >= 400 && response.status < 600 ? response.status : 502;
    throw error;
  }
  pluggyApiKey = data.apiKey;
  pluggyApiKeyExpiresAt = Date.now() + 110 * 60 * 1000;
  return pluggyApiKey;
}

async function pluggyRequest(endpoint) {
  const apiKey = await getPluggyApiKey();
  let response;
  try {
    response = await fetch(`https://api.pluggy.ai${endpoint}`, {
      headers: { 'X-API-KEY': apiKey }, signal: AbortSignal.timeout(20000), cache: 'no-store'
    });
  } catch {
    const error = new Error('Não foi possível consultar a API Pluggy. Verifique a conexão e tente novamente.');
    error.status = 502;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.message === 'string' ? data.message.replace(/[\r\n\t]/g, ' ').slice(0, 180) : '';
    const error = new Error(`Consulta Pluggy recusada (HTTP ${response.status}). ${detail || 'Confira a conexão Open Finance e as credenciais.'}`);
    error.status = response.status >= 400 && response.status < 600 ? response.status : 502;
    throw error;
  }
  return data;
}

async function createPluggyConnectToken(clientUserId) {
  const apiKey = await getPluggyApiKey();
  let response;
  try {
    response = await fetch('https://api.pluggy.ai/connect_token', {
      method: 'POST', headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: { clientUserId, avoidDuplicates: true } }),
      signal: AbortSignal.timeout(15000), cache: 'no-store'
    });
  } catch {
    const error = new Error('Não foi possível solicitar um Connect Token à Pluggy. Verifique a conexão do servidor.');
    error.status = 502;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.accessToken) {
    const detail = typeof data.message === 'string' ? data.message.replace(/[\r\n\t]/g, ' ').slice(0, 180) : '';
    const error = new Error(`Não foi possível preparar a autorização Pluggy (HTTP ${response.status}). ${detail || 'Confira suas credenciais.'}`);
    error.status = response.status >= 400 && response.status < 600 ? response.status : 502;
    throw error;
  }
  return data.accessToken;
}

async function listPluggyTransactions(accountId) {
  const all = [];
  let endpoint = `/v2/transactions?accountId=${encodeURIComponent(accountId)}`;
  for (let page = 0; endpoint && page < 10; page++) {
    const data = await pluggyRequest(endpoint);
    all.push(...(Array.isArray(data.results) ? data.results : []));
    const next = typeof data.next === 'string' ? data.next : '';
    endpoint = next ? `/v2/transactions${next.startsWith('?') ? next : `?${next}`}` : '';
    if (endpoint && !endpoint.startsWith('/v2/transactions?')) throw new Error('Cursor de transações Pluggy inválido.');
  }
  return all;
}

async function loadDotEnv() {
  try {
    const content = await readFile(path.join(ROOT, '.env'), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  } catch {}
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders(), ...headers });
  res.end(JSON.stringify(body));
}

function securityHeaders(nonce = '') {
  const scriptPolicy = nonce ? `'self' 'nonce-${nonce}' https://cdn.pluggy.ai` : `'self' https://cdn.pluggy.ai`;
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': `default-src 'self'; script-src ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.pluggy.ai https://connect.pluggy.ai https://data-api.binance.vision https://api.binance.com https://api1.binance.com https://api2.binance.com https://api3.binance.com; frame-src https://connect.pluggy.ai; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
  };
  if (process.env.NODE_ENV === 'production') headers['Strict-Transport-Security'] = 'max-age=31536000';
  return headers;
}

function requestOriginAllowed(req) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return false;
  let expected = String(process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '').trim();
  if (!expected && process.env.VERCEL && req.headers.host) expected = `https://${req.headers.host}`;
  if (!expected) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = forwardedProto === 'https' ? 'https' : 'http';
    expected = `${protocol}://${req.headers.host || 'localhost'}`;
  }
  try { return new URL(origin).origin === new URL(expected).origin; } catch { return false; }
}

function rateLimitBucket(kind, remote) {
  return `${kind}:${createHash('sha256').update(String(remote || 'local')).digest('hex')}`;
}

async function getRateLimit(kind, remote, windowMs) {
  const bucket = rateLimitBucket(kind, remote);
  const row = await dbGet('SELECT hit_count, window_started_at FROM auth_rate_limits WHERE bucket_key = ?', bucket);
  if (!row || Date.now() - Date.parse(row.window_started_at) > windowMs) return { bucket, count: 0 };
  return { bucket, count: Number(row.hit_count) || 0 };
}

async function incrementRateLimit(kind, remote, windowMs) {
  const bucket = rateLimitBucket(kind, remote);
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const row = await dbGet(`INSERT INTO auth_rate_limits (bucket_key, hit_count, window_started_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      hit_count = CASE WHEN auth_rate_limits.window_started_at < ? THEN 1 ELSE auth_rate_limits.hit_count + 1 END,
      window_started_at = CASE WHEN auth_rate_limits.window_started_at < ? THEN excluded.window_started_at ELSE auth_rate_limits.window_started_at END
    RETURNING hit_count`, bucket, now, cutoff, cutoff);
  return Number(row?.hit_count) || 0;
}

async function clearRateLimit(kind, remote) {
  await dbRun('DELETE FROM auth_rate_limits WHERE bucket_key = ?', rateLimitBucket(kind, remote));
}

function requestAddress(req) {
  if (process.env.VERCEL) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean);
    if (forwarded.length) return forwarded[0].slice(0, 64);
  }
  if (process.env.RENDER === 'true') {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean);
    if (forwarded.length) return forwarded[forwarded.length - 1].slice(0, 64);
  }
  return req.socket.remoteAddress || 'local';
}

function htmlResponse(res, html, nonce) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...securityHeaders(nonce) });
  res.end(html);
}

function getCookie(req, name) {
  const parts = (req.headers.cookie || '').split(';');
  for (const part of parts) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

function sessionHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function currentSession(req) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const hash = sessionHash(token);
  const now = new Date().toISOString();
  const session = await dbGet('SELECT user_id AS "userId", username FROM user_sessions WHERE token_hash = ? AND expires_at > ?', hash, now);
  if (!session) {
    await dbRun('DELETE FROM user_sessions WHERE token_hash = ?', hash);
    return null;
  }
  const expiresAt = new Date(Date.now() + SESSION_TTL).toISOString();
  await dbRun('UPDATE user_sessions SET expires_at = ? WHERE token_hash = ?', expiresAt, hash);
  return session;
}

function sessionCookie(token, req) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}${secure}`;
}

function clearSessionCookie(req) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

function pbkdf(password, salt) {
  return new Promise((resolve, reject) => pbkdf2(password, salt, 310000, 32, 'sha256', (error, key) => error ? reject(error) : resolve(key)));
}

async function readJson(req, maxBytes = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function createSession(res, req, user, extra = {}) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL).toISOString();
  await dbRun('INSERT INTO user_sessions (token_hash, user_id, username, expires_at) VALUES (?, ?, ?, ?)', sessionHash(token), user.id, user.username, expiresAt);
  send(res, 200, { ok: true, userId: user.id, username: user.username, ...extra }, { 'Set-Cookie': sessionCookie(token, req) });
}

function publicPage(nonce) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#102a24"><title>Minhas Finanças · Planeje com clareza</title><style nonce="${nonce}">
  *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f7f8f5;color:#18332d;font:16px Arial,sans-serif}.wrap{width:min(1120px,calc(100% - 40px));margin:auto}.top{height:86px;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:11px;font-weight:750;font-size:20px}.mark{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:linear-gradient(145deg,#28755f,#173c31);color:#fff}.mark svg{width:28px;height:28px}.links{display:flex;align-items:center;gap:12px}.button{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;padding:12px 18px;border:1px solid #dce5df;border-radius:9px;color:#244f41;font-size:13px;font-weight:700}.primary{background:#215a47;color:#fff;border-color:#215a47}.hero{display:grid;grid-template-columns:1.08fr .92fr;align-items:center;gap:58px;padding:72px 0 84px}.eyebrow{font-size:11px;font-weight:700;letter-spacing:1.7px;color:#56816c}.hero h1{font-size:clamp(40px,6vw,68px);line-height:1.04;letter-spacing:-2.8px;margin:15px 0 20px}.hero h1 em{color:#428268;font-style:normal}.copy{max-width:520px;color:#697871;line-height:1.75;font-size:17px}.hero-actions{display:flex;gap:12px;margin-top:30px}.preview{padding:26px;background:#fff;border:1px solid #e5ebe6;border-radius:22px;box-shadow:0 24px 65px #18332d12;transform:rotate(1deg)}.preview-top{display:flex;justify-content:space-between;color:#75827a;font-size:12px}.balance{font-size:31px;font-weight:750;margin:15px 0 22px}.bars{height:165px;display:flex;align-items:flex-end;gap:13px;padding:0 4px;border-bottom:1px solid #e8ede9}.bar{flex:1;border-radius:7px 7px 0 0;background:#d8e8dc}.bar:nth-child(2n){background:#5a9b78}.bar:nth-child(1){height:36%}.bar:nth-child(2){height:64%}.bar:nth-child(3){height:49%}.bar:nth-child(4){height:82%}.bar:nth-child(5){height:57%}.bar:nth-child(6){height:72%}.labels{display:flex;justify-content:space-between;color:#89948d;font-size:10px;margin-top:10px}.features{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;padding-bottom:70px}.feature{background:#fff;border:1px solid #e8ece9;border-radius:14px;padding:21px}.feature b{display:block;margin-bottom:8px}.feature span{font-size:13px;line-height:1.6;color:#75827a}@media(max-width:720px){.hero{grid-template-columns:1fr;gap:32px;padding:52px 0}.features{grid-template-columns:1fr}.top{height:72px}.hero h1{letter-spacing:-1.7px}.copy{font-size:15px}}@media(max-width:430px){.links .secondary{display:none}.hero-actions{flex-direction:column}.button{width:100%}.preview{padding:19px}}
  </style></head><body><header class="top wrap"><div class="brand"><span class="mark"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 28.5 16.2 20l5.1 5.2L32 13.5M25.8 13.5H32v6.2" fill="none" stroke="currentColor" stroke-width="3.3" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>Minhas Finanças</span></div><nav class="links"><a class="button secondary" href="/register">Criar conta</a><a class="button primary" href="/login">Acessar minha conta</a></nav></header><main class="wrap"><section class="hero"><div><p class="eyebrow">MAIS CLAREZA PARA ESCOLHER</p><h1>Seu dinheiro,<br><em>no rumo dos seus planos.</em></h1><p class="copy">Organize entradas, despesas, cartões e investimentos em um só lugar. Acompanhe seu orçamento e tome decisões com mais tranquilidade.</p><div class="hero-actions"><a class="button primary" href="/login">Acessar minha conta</a><a class="button" href="/register">Ainda não tenho conta</a></div></div><div class="preview" aria-label="Ilustração de um painel financeiro"><div class="preview-top"><span>Visão geral</span><span>Este mês</span></div><div class="balance">Seu planejamento</div><div class="bars"><i class="bar"></i><i class="bar"></i><i class="bar"></i><i class="bar"></i><i class="bar"></i><i class="bar"></i></div><div class="labels"><span>Sem 1</span><span>Sem 2</span><span>Sem 3</span><span>Sem 4</span><span>Sem 5</span><span>Mês</span></div></div></section><section class="features"><article class="feature"><b>Visão organizada</b><span>Entradas, saídas e custos fixos reunidos para acompanhar sua rotina.</span></article><article class="feature"><b>Planejamento mensal</b><span>Compare seus limites planejados com o que foi realizado.</span></article><article class="feature"><b>Mais controle</b><span>Acompanhe cartões e investimentos no mesmo painel.</span></article></section></main></body></html>`;
}

function accessPage(mode, nonce) {
  const setupRequired = mode === 'register';
  const forgot = mode === 'forgot';
  const heading = setupRequired ? 'Crie sua conta' : forgot ? 'Redefina sua senha' : 'Acesse seu controle';
  const detail = setupRequired ? 'Cadastre seu usuário, e-mail e senha. O e-mail será usado para verificar sua conta e recuperar o acesso.' : forgot ? 'Informe o e-mail verificado da sua conta para receber um código temporário.' : 'Entre para continuar para seu painel financeiro.';
  const passwordField = `<label>Senha<input name="password" type="password" autocomplete="${setupRequired ? 'new-password' : 'current-password'}" required minlength="${setupRequired ? '12' : '1'}"></label>${setupRequired ? '<label>Confirme a senha<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="12"></label>' : ''}`;
  const route = setupRequired ? '/api/setup' : forgot ? '/api/password-reset' : '/api/login';
  const submit = setupRequired ? 'Criar conta' : forgot ? 'Salvar nova senha' : 'Entrar';
  const links = forgot ? '<a href="/login">Voltar para o login</a>' : setupRequired ? '<a href="/login">Já tenho conta · Entrar</a>' : '<a href="/forgot-password">Esqueceu a senha?</a><a href="/register">Ainda não tenho conta · Cadastrar</a>';
  const recoveryNotice = setupRequired ? '<p class="hint">Após o cadastro, será exibido também um código de recuperação. Guarde-o em local seguro.</p>' : '';
  const formMarkup = setupRequired
    ? `<form id="access"><label>Usuário<input name="username" autocomplete="username" required minlength="3" maxlength="40"></label><label>E-mail<input name="email" type="email" autocomplete="email" required maxlength="254"></label>${passwordField}<button>${submit}</button><div class="error" id="error" role="alert"></div><div class="success" id="success" hidden></div></form>`
    : forgot
      ? `<form id="requestEmail"><label>E-mail da conta<input name="email" type="email" autocomplete="email" required maxlength="254"></label><button>Enviar código por e-mail</button><div class="error" id="requestError" role="alert"></div><div class="success" id="requestSuccess" hidden></div></form><form id="emailReset" hidden><label>E-mail da conta<input name="email" type="email" autocomplete="email" required maxlength="254"></label><label>Código enviado por e-mail<input name="code" autocomplete="one-time-code" inputmode="numeric" required minlength="8" maxlength="8"></label><label>Nova senha<input name="password" type="password" autocomplete="new-password" required minlength="12"></label><label>Confirme a nova senha<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="12"></label><button>Redefinir senha</button><div class="error" id="emailResetError" role="alert"></div></form><form id="recoveryReset" hidden><label>Usuário<input name="username" autocomplete="username" required minlength="3" maxlength="40"></label><label>Código de recuperação salvo no cadastro<input name="recoveryCode" autocomplete="one-time-code" required minlength="10"></label><label>Nova senha<input name="password" type="password" autocomplete="new-password" required minlength="12"></label><label>Confirme a nova senha<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="12"></label><button>Redefinir com código de recuperação</button><div class="error" id="recoveryError" role="alert"></div></form><nav class="links"><a href="#" id="toggleRecovery">Usar código de recuperação</a></nav>`
      : `<form id="access"><label>Usuário<input name="username" autocomplete="username" required minlength="3" maxlength="40"></label>${passwordField}<button>${submit}</button><div class="error" id="error" role="alert"></div><div class="success" id="success" hidden></div></form>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${heading} · Minhas Finanças</title><style nonce="${nonce}">
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8f5;color:#18332d;font:14px Arial,sans-serif}.box{width:min(420px,calc(100% - 32px));background:#fff;border:1px solid #e8ece9;border-radius:16px;padding:30px;box-shadow:0 18px 55px #18332d12}.brand{display:flex;align-items:center;gap:9px;font-weight:bold;font-size:18px;margin-bottom:28px;text-decoration:none;color:inherit}.mark{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:linear-gradient(145deg,#28755f,#173c31);color:#fff}.mark svg{width:25px;height:25px}.eyebrow{font-size:9px;font-weight:bold;letter-spacing:1.5px;color:#87938d}h1{font-size:24px;margin:8px 0}.copy{font-size:12px;line-height:1.6;color:#78837f;margin-bottom:22px}label{display:flex;flex-direction:column;gap:7px;margin:14px 0;color:#64716a;font-size:11px}input{height:42px;border:1px solid #e1e7e2;border-radius:7px;padding:0 10px;font-size:13px}button{width:100%;border:0;border-radius:8px;background:#215a47;color:#fff;padding:13px;font-size:12px;font-weight:bold;margin-top:9px;cursor:pointer}.hint{font-size:11px;line-height:1.6;color:#748179;margin-top:14px}.error{min-height:16px;color:#aa5947;font-size:11px;margin-top:12px}.success{padding:12px;background:#eff7f1;border:1px solid #d5e7d8;border-radius:8px;color:#245d43;font-size:12px;line-height:1.6;overflow-wrap:anywhere}.links{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:16px}.links a{font-size:11px;color:#28664d}.back{display:block;font-size:11px;color:#728078;text-decoration:none;margin-top:18px}@media(max-width:430px){.box{padding:24px}}
  </style></head><body><main class="box"><a class="brand" href="/"><span class="mark"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 28.5 16.2 20l5.1 5.2L32 13.5M25.8 13.5H32v6.2" fill="none" stroke="currentColor" stroke-width="3.3" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>Minhas Finanças</span></a><div class="eyebrow">ACESSO PROTEGIDO</div><h1>${heading}</h1><p class="copy">${detail}</p>${formMarkup}${recoveryNotice}<nav class="links">${links}</nav><a class="back" href="/">← Página de apresentação</a></main><script nonce="${nonce}">
  const post=async(path,data)=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível concluir.');return result};const show=id=>message=>{document.querySelector(id).textContent=message};
  ${setupRequired || !forgot ? `document.querySelector('#access').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form));${setupRequired ? "if(data.password!==data.confirmPassword){show('#error')('As senhas não conferem.');return;}" : ''}try{const result=await post('${route}',data);if(result.recoveryCode){form.hidden=true;document.querySelector('.links').hidden=true;document.querySelector('.copy').textContent='Conta criada. Guarde os códigos exibidos e verifique seu e-mail na área da conta.';const message=document.querySelector('#success');message.hidden=false;message.textContent='Código de recuperação (exibido uma única vez): '+result.recoveryCode+(result.emailVerificationSent?' · Código de verificação enviado para '+data.email:result.emailMessage?' · '+result.emailMessage:'');const next=document.createElement('a');next.href='/';next.className='button-link';next.style.cssText='display:block;text-align:center;padding:13px;margin-top:16px;border-radius:8px;background:#215a47;color:#fff;text-decoration:none;font-size:12px;font-weight:bold';next.textContent='Acessar o painel';document.querySelector('.box').append(next);return;}location.replace('/')}catch(error){show('#error')(error.message)}});` : ''}
  ${forgot ? `const requestForm=document.querySelector('#requestEmail'),resetForm=document.querySelector('#emailReset'),recoveryForm=document.querySelector('#recoveryReset');let useRecovery=false;requestForm.addEventListener('submit',async event=>{event.preventDefault();const email=requestForm.elements.email.value.trim();try{await post('/api/password-reset/request',{email});document.querySelector('#requestSuccess').hidden=false;document.querySelector('#requestSuccess').textContent='Se o e-mail estiver verificado, enviaremos um código válido por 15 minutos.';resetForm.elements.email.value=email;requestForm.hidden=true;resetForm.hidden=false;document.querySelector('#toggleRecovery').textContent='Usar código de recuperação';}catch(error){show('#requestError')(error.message)}});resetForm.addEventListener('submit',async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(resetForm));if(data.password!==data.confirmPassword){show('#emailResetError')('As senhas não conferem.');return;}try{await post('/api/password-reset/email',data);document.querySelector('.copy').textContent='Senha redefinida. Você já pode entrar com a nova senha.';resetForm.hidden=true;requestForm.hidden=true;document.querySelector('#toggleRecovery').hidden=true;}catch(error){show('#emailResetError')(error.message)}});recoveryForm.addEventListener('submit',async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(recoveryForm));if(data.password!==data.confirmPassword){show('#recoveryError')('As senhas não conferem.');return;}try{await post('/api/password-reset',data);document.querySelector('.copy').textContent='Senha redefinida. Você já pode entrar com a nova senha.';recoveryForm.hidden=true;document.querySelector('#toggleRecovery').hidden=true;}catch(error){show('#recoveryError')(error.message)}});document.querySelector('#toggleRecovery').addEventListener('click',event=>{event.preventDefault();useRecovery=!useRecovery;requestForm.hidden=useRecovery;resetForm.hidden=true;recoveryForm.hidden=!useRecovery;event.currentTarget.textContent=useRecovery?'Voltar à recuperação por e-mail':'Usar código de recuperação';});` : ''}
  </script></body></html>`;
}

function accountEmailPage(nonce, user) {
  const email = String(user.email || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const status = user.emailVerifiedAt ? 'E-mail verificado' : email ? 'E-mail ainda não verificado' : 'Nenhum e-mail associado';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>E-mail da conta · Minhas Finanças</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8f5;color:#18332d;font:14px Arial,sans-serif}.box{width:min(460px,calc(100% - 32px));background:white;border:1px solid #e8ece9;border-radius:16px;padding:30px;box-shadow:0 18px 55px #18332d12}h1{font-size:24px;margin:8px 0}.copy{font-size:13px;line-height:1.65;color:#718078}label{display:flex;flex-direction:column;gap:7px;margin:15px 0;color:#64716a;font-size:12px}input{height:43px;border:1px solid #e1e7e2;border-radius:7px;padding:0 10px;font-size:14px}button,.back{display:block;width:100%;border:0;border-radius:8px;background:#215a47;color:white;padding:13px;font-size:13px;font-weight:bold;margin-top:10px;text-align:center;text-decoration:none;cursor:pointer}.msg{min-height:18px;margin-top:12px;font-size:12px;color:#aa5947}.ok{color:#245d43}.links{margin-top:18px;font-size:12px;color:#28664d}</style></head><body><main class="box"><p>MINHAS FINANÇAS · CONTA</p><h1>Recuperação por e-mail</h1><p class="copy">Associe um e-mail que você controla. Para proteger a conta, confirmaremos o endereço com um código de uso único antes de permitir a recuperação de senha.</p><p class="copy"><strong>Endereço atual:</strong> ${email || 'não cadastrado'}<br><strong>Situação:</strong> ${status}</p><form id="request"><label>Novo e-mail<input name="email" type="email" maxlength="254" autocomplete="email" value="${email}" required></label><button>Enviar código de verificação</button></form><form id="verify" hidden><label>E-mail a verificar<input name="email" type="email" readonly></label><label>Código de verificação<input name="code" inputmode="numeric" autocomplete="one-time-code" minlength="8" maxlength="8" required></label><button>Confirmar e-mail</button></form><div id="message" class="msg" role="status"></div><a class="back" href="/">Voltar ao painel</a><div class="links"><a href="/login">Sair e ir ao login</a></div></main><script nonce="${nonce}">const requestForm=document.querySelector('#request'),verifyForm=document.querySelector('#verify'),message=document.querySelector('#message');async function post(path,data){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível concluir.');return result}requestForm.addEventListener('submit',async e=>{e.preventDefault();try{const email=requestForm.elements.email.value.trim();await post('/api/account/email/request',{email});verifyForm.elements.email.value=email;requestForm.hidden=true;verifyForm.hidden=false;message.className='msg ok';message.textContent='Se o remetente estiver configurado, enviamos um código válido por 15 minutos.'}catch(error){message.textContent=error.message}});verifyForm.addEventListener('submit',async e=>{e.preventDefault();try{await post('/api/account/email/verify',Object.fromEntries(new FormData(verifyForm)));message.className='msg ok';message.textContent='E-mail verificado e associado à conta. A recuperação de senha já está habilitada.';verifyForm.hidden=true;requestForm.hidden=true}catch(error){message.textContent=error.message}});</script></body></html>`;
}

async function signedBinanceRead(pathname, apiKey, apiSecret, hosts, clockOffset, query = {}) {
  const params = new URLSearchParams({ ...query, timestamp: String(Math.round(Date.now() + clockOffset)), recvWindow: '5000' });
  const signature = createHmac('sha256', apiSecret).update(params.toString()).digest('hex');
  let response;
  for (const host of hosts) {
    try {
      response = await fetch(`https://${host}${pathname}?${params.toString()}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': apiKey }, signal: AbortSignal.timeout(10000), cache: 'no-store'
      });
      if (response.ok || response.status < 500) break;
    } catch {}
  }
  if (!response?.ok) return null;
  try { return await response.json(); } catch { return null; }
}

async function binanceHistoricalCloses(symbol, startTime, endTime, hosts) {
  const closes = new Map();
  const day = 86_400_000;
  for (let start = Math.floor(startTime / day) * day; start <= endTime; start += 1000 * day) {
    const end = Math.min(endTime, start + 1000 * day - 1);
    const query = new URLSearchParams({ symbol, interval: '1d', startTime: String(start), endTime: String(end), limit: '1000' });
    for (const host of hosts) {
      try {
        const response = await fetch(`https://${host}/api/v3/klines?${query}`, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
        if (!response.ok) { if (response.status >= 500) continue; break; }
        const candles = await response.json();
        for (const candle of candles) closes.set(Number(candle[0]), Number(candle[4]));
        break;
      } catch {}
    }
  }
  return closes;
}

const CRYPTO_EXCHANGES = Object.freeze({
  binance: { name: 'Binance', fields: ['apiKey', 'apiSecret'] },
  mercadobitcoin: { name: 'Mercado Bitcoin', fields: ['apiKey', 'apiSecret'] },
  coinbase: { name: 'Coinbase', fields: ['apiKey', 'privateKey'] },
  okx: { name: 'OKX', fields: ['apiKey', 'apiSecret', 'passphrase'] },
  bybit: { name: 'Bybit', fields: ['apiKey', 'apiSecret'] },
  kraken: { name: 'Kraken', fields: ['apiKey', 'apiSecret'] }
});

function cryptoBalance(asset, free, locked = 0, extra = {}) {
  const raw = String(asset || '').toUpperCase().trim();
  const aliases = { XBT: 'BTC', XXBT: 'BTC', XETH: 'ETH', XXETH: 'ETH', ZUSD: 'USD', ZEUR: 'EUR', ZGBP: 'GBP', ZCAD: 'CAD', ZJPY: 'JPY' };
  const symbol = aliases[raw] || raw.split('-')[0];
  const available = Number(free) || 0;
  const held = Number(locked) || 0;
  return { asset: symbol, free: available, locked: held, total: available + held, ...extra };
}

async function exchangeJson(url, options, exchangeName) {
  let response;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000), cache: 'no-store' }); }
  catch (error) { throw Object.assign(new Error('Não foi possível conectar à API da ' + exchangeName + '. Verifique a conexão e tente novamente.'), { status: 502 }); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload.code || payload.retCode || payload.error || payload.message || '';
    throw Object.assign(new Error('A ' + exchangeName + ' recusou a consulta (HTTP ' + response.status + (code ? ', código ' + String(code).slice(0, 80) : '') + '). Confira a chave, o segredo, as permissões somente leitura e a restrição de IP.'), { status: response.status >= 400 && response.status < 600 ? response.status : 502 });
  }
  return payload;
}

function compactBalances(entries) {
  const totals = new Map();
  for (const item of entries) {
    const symbol = String(item.asset || '').toUpperCase().trim();
    const total = Number(item.total);
    if (!/^[A-Z0-9]{2,20}$/.test(symbol) || !Number.isFinite(total) || total <= 0) continue;
    const previous = totals.get(symbol) || { asset: symbol, free: 0, locked: 0, total: 0 };
    previous.free += Number(item.free) || 0; previous.locked += Number(item.locked) || 0; previous.total += total;
    totals.set(symbol, previous);
  }
  return [...totals.values()].filter(item => item.total > 0);
}

function base64url(value) { return Buffer.from(value).toString('base64url'); }
function coinbaseJwt(apiKey, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: apiKey, nonce: randomBytes(16).toString('hex') };
  const claims = { iss: 'cdp', nbf: now - 5, exp: now + 120, sub: apiKey, uri: 'GET api.coinbase.com/api/v3/brokerage/accounts' };
  const input = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claims));
  const signature = cryptoSign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return input + '.' + signature.toString('base64url');
}

async function fetchCryptoExchangeAccount(provider, credentials) {
  const spec = CRYPTO_EXCHANGES[provider];
  if (!spec) throw Object.assign(new Error('Corretora cripto não disponível.'), { status: 400 });
  if (!credentials || spec.fields.some(field => !credentials[field])) return { configured: false, exchange: provider, balances: [] };
  let balances = [];
  if (provider === 'binance') {
    const data = await signedBinanceAccount(credentials.apiKey, credentials.apiSecret);
    return { ...data, exchange: provider };
  }
  if (provider === 'mercadobitcoin') {
    const form = new URLSearchParams({ grant_type: 'client_credentials', scope: 'global', client_id: credentials.apiKey, client_secret: credentials.apiSecret });
    const token = await exchangeJson('https://api.mercadobitcoin.net/api/v4/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() }, spec.name);
    if (!token.access_token) throw Object.assign(new Error('A ' + spec.name + ' não retornou um token válido. Confira as credenciais.'), { status: 502 });
    const headers = { Authorization: 'Bearer ' + token.access_token };
    const accountsPayload = await exchangeJson('https://api.mercadobitcoin.net/api/v4/accounts', { headers }, spec.name);
    const accounts = Array.isArray(accountsPayload) ? accountsPayload : (accountsPayload.results || accountsPayload.data || []);
    const account = accounts[0];
    if (!account || !account.id) throw Object.assign(new Error('Nenhuma conta foi encontrada no Mercado Bitcoin.'), { status: 502 });
    const payload = await exchangeJson('https://api.mercadobitcoin.net/api/v4/accounts/' + encodeURIComponent(account.id) + '/balances', { headers }, spec.name);
    const rows = Array.isArray(payload) ? payload : (payload.results || payload.data || []);
    balances = rows.map(item => { const asset = String(item.symbol || item.currency || '').split('-')[0]; const total = Number(item.total); const locked = Number(item.on_hold) || 0; return cryptoBalance(asset, Number.isFinite(total) ? Math.max(0, total - locked) : item.available, locked); });
  } else if (provider === 'coinbase') {
    const jwt = coinbaseJwt(credentials.apiKey, credentials.privateKey);
    const payload = await exchangeJson('https://api.coinbase.com/api/v3/brokerage/accounts?limit=250', { headers: { Authorization: 'Bearer ' + jwt } }, spec.name);
    const rows = Array.isArray(payload.accounts) ? payload.accounts : [];
    balances = rows.map(item => cryptoBalance(item.currency, Number(item.available_balance && item.available_balance.value) + Number(item.hold && item.hold.value)));
  } else if (provider === 'okx') {
    const timestamp = new Date().toISOString();
    const path = '/api/v5/account/balance';
    const signature = createHmac('sha256', credentials.apiSecret).update(timestamp + 'GET' + path).digest('base64');
    const payload = await exchangeJson('https://www.okx.com' + path, { headers: { 'OK-ACCESS-KEY': credentials.apiKey, 'OK-ACCESS-SIGN': signature, 'OK-ACCESS-TIMESTAMP': timestamp, 'OK-ACCESS-PASSPHRASE': credentials.passphrase } }, spec.name);
    if (String(payload.code) !== '0') throw Object.assign(new Error('A OKX recusou a autenticação. Confira chave, senha da API e permissões somente leitura.'), { status: 502 });
    const rows = (payload.data || []).flatMap(account => account.details || []);
    balances = rows.map(item => { const free = Number(item.availBal) || 0; const locked = Number(item.frozenBal) || 0; const cash = Number(item.cashBal); return cryptoBalance(item.ccy, free, locked, Number.isFinite(cash) && cash > free + locked ? { total: cash } : {}); });
  } else if (provider === 'bybit') {
    const timestamp = String(Date.now()), recvWindow = '5000', query = 'accountType=UNIFIED';
    const signature = createHmac('sha256', credentials.apiSecret).update(timestamp + credentials.apiKey + recvWindow + query).digest('hex');
    const payload = await exchangeJson('https://api.bybit.com/v5/account/wallet-balance?' + query, { headers: { 'X-BAPI-API-KEY': credentials.apiKey, 'X-BAPI-SIGN': signature, 'X-BAPI-TIMESTAMP': timestamp, 'X-BAPI-RECV-WINDOW': recvWindow } }, spec.name);
    if (Number(payload.retCode) !== 0) throw Object.assign(new Error('A Bybit recusou a autenticação ou a consulta de saldo. Confira as permissões somente leitura.'), { status: 502 });
    const rows = (payload.result && payload.result.list || []).flatMap(account => account.coin || []);
    balances = rows.map(item => { const total = Number(item.walletBalance) || 0; const locked = Math.min(total, Number(item.locked) || 0); return cryptoBalance(item.coin, Math.max(0, total - locked), locked); });
  } else if (provider === 'kraken') {
    const path = '/0/private/Balance';
    const nonce = String(Date.now() * 1000);
    const body = new URLSearchParams({ nonce }).toString();
    const digest = createHash('sha256').update(nonce + body).digest();
    const secret = Buffer.from(credentials.apiSecret, 'base64');
    const signature = createHmac('sha512', secret).update(Buffer.concat([Buffer.from(path), digest])).digest('base64');
    const payload = await exchangeJson('https://api.kraken.com' + path, { method: 'POST', headers: { 'API-Key': credentials.apiKey, 'API-Sign': signature, 'Content-Type': 'application/x-www-form-urlencoded' }, body }, spec.name);
    if (Array.isArray(payload.error) && payload.error.length) throw Object.assign(new Error('A Kraken recusou a consulta. Confira a chave, a assinatura e as permissões somente leitura.'), { status: 502 });
    balances = Object.entries(payload.result || {}).map(([asset, amount]) => cryptoBalance(asset, Number(amount) || 0));
  }
  return { configured: true, exchange: provider, updatedAt: new Date().toISOString(), balances: compactBalances(balances) };
}

async function signedBinanceAccount(apiKey, apiSecret) {
  if (!apiKey || !apiSecret) return { configured: false };
  // Binance documents these official REST API hosts. Try another host only for
  // transient network/server failures; authentication and regional responses
  // must remain visible instead of being retried as a way around restrictions.
  const hosts = ['api.binance.com', 'api-gcp.binance.com', 'api1.binance.com', 'api2.binance.com', 'api3.binance.com', 'api4.binance.com'];
  // Signed endpoints validate the timestamp against Binance's clock. Estimate
  // the offset using the midpoint of the /time request to compensate for both
  // a misconfigured Windows clock and ordinary network latency.
  let clockOffset = 0;
  let timeResponse;
  for (const host of hosts) {
    const requestStartedAt = Date.now();
    try {
      timeResponse = await fetch(`https://${host}/api/v3/time`, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
      const requestEndedAt = Date.now();
      if (timeResponse.ok) {
        const serverClock = Number((await timeResponse.json()).serverTime);
        if (!Number.isFinite(serverClock)) throw new Error('A Binance retornou um horário inválido.');
        clockOffset = serverClock - ((requestStartedAt + requestEndedAt) / 2);
        break;
      }
      if (timeResponse.status < 500) break;
    } catch (error) {
      if (error.message === 'A Binance retornou um horário inválido.') throw error;
    }
  }
  if (!timeResponse?.ok) {
    const status = timeResponse?.status;
    const error = new Error(status === 451
      ? 'A Binance informou indisponibilidade regional ao consultar o horário (HTTP 451). Confira a disponibilidade para sua região.'
      : 'Não foi possível sincronizar o horário com a Binance. Verifique a conexão e a data/hora do computador e tente novamente.');
    error.status = status && status >= 400 && status < 600 ? status : 502;
    throw error;
  }
  const params = new URLSearchParams({ timestamp: String(Math.round(Date.now() + clockOffset)), recvWindow: '5000' });
  const signature = createHmac('sha256', apiSecret).update(params.toString()).digest('hex');
  let response;
  let lastNetworkError;
  for (const host of hosts) {
    try {
      response = await fetch(`https://${host}/api/v3/account?${params.toString()}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': apiKey },
        signal: AbortSignal.timeout(10000),
        cache: 'no-store'
      });
      if (response.ok || response.status < 500) break;
    } catch (error) {
      lastNetworkError = error;
    }
  }
  if (!response) {
    const error = new Error(`Não foi possível alcançar a API da Binance pelos endereços oficiais. ${lastNetworkError?.name === 'TimeoutError' ? 'A consulta expirou.' : 'Verifique sua conexão e tente novamente.'}`);
    error.status = 502;
    throw error;
  }
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch {}
    const code = Number.isFinite(Number(payload.code)) ? Number(payload.code) : null;
    const apiMessage = typeof payload.msg === 'string'
      ? payload.msg.replace(/[\r\n\t]/g, ' ').replaceAll(apiKey, '[chave oculta]').replaceAll(apiSecret, '[segredo oculto]').slice(0, 240)
      : '';
    let explanation = apiMessage ? `Mensagem da Binance: ${apiMessage}` : 'A Binance não informou detalhes adicionais.';
    if (code === -2015) explanation = 'A Binance não aceitou a chave, o IP de saída ou as permissões desta API. Confira se a chave pertence à conta correta, permite leitura e autoriza o IP público atual.';
    else if (code === -1022) explanation = 'A assinatura foi recusada. Confira se o segredo pertence a esta chave e se foi copiado corretamente, sem espaços.';
    else if (code === -1021) explanation = 'O horário do computador está fora da janela aceita pela Binance. Sincronize a data e a hora e tente novamente.';
    else if (response.status === 451) explanation = 'A API da Binance informou indisponibilidade regional (HTTP 451). Confira a disponibilidade da Binance para sua região.';
    else if (response.status === 429 || response.status === 418) explanation = `A Binance limitou as consultas (HTTP ${response.status}). Aguarde antes de tentar novamente${apiMessage ? `: ${apiMessage}` : '.'}`;
    const error = new Error(`Consulta Binance recusada (HTTP ${response.status}${code !== null ? `, código ${code}` : ''}). ${explanation}`);
    error.status = response.status >= 400 && response.status < 600 ? response.status : 502;
    throw error;
  }
  const data = await response.json();
  const balances = (data.balances || []).map(item => ({
    asset: item.asset,
    free: Number(item.free) || 0,
    locked: Number(item.locked) || 0,
    total: (Number(item.free) || 0) + (Number(item.locked) || 0)
  })).filter(item => item.total > 0);
  // Use the account's read-only trade history to derive the cost of each
  // remaining position. BRL fills use their actual quote quantity; USDT fills
  // are converted with the historical daily USDT/BRL close for each trade day.
  const tradeSets = await Promise.all(balances.filter(item => item.asset !== 'BRL').map(async balance => {
    const balanceAsset = String(balance.asset).toUpperCase();
    // Binance may still return the legacy balance ticker while its active spot markets use KERNEL.
    const asset = balanceAsset === 'LDKERNEL' ? 'KERNEL' : balanceAsset;
    if (!/^[A-Z0-9]{2,20}$/.test(asset)) return { asset, balanceAsset, trades: [] };
    const trades = [];
    for (const quoteAsset of ['BRL', 'USDT', 'USDC', 'FDUSD']) {
      if (asset === quoteAsset) continue;
      const result = await signedBinanceRead('/api/v3/myTrades', apiKey, apiSecret, hosts, clockOffset, { symbol: `${asset}${quoteAsset}`, limit: '1000' });
      if (Array.isArray(result)) trades.push(...result.map(trade => ({ ...trade, quoteAsset })));
    }
    return { asset, balanceAsset, balance: balance.total, trades };
  }));
  const tradeTimes = tradeSets.flatMap(set => set.trades.map(trade => Number(trade.time)).filter(Number.isFinite));
  const tradeStart = tradeTimes.length ? Math.min(...tradeTimes) : 0;
  const tradeEnd = tradeTimes.length ? Math.max(...tradeTimes) : 0;
  const needsUsdtRate = tradeSets.some(set => set.trades.some(trade => trade.quoteAsset !== 'BRL'));
  const usdtRates = needsUsdtRate ? await binanceHistoricalCloses('USDTBRL', tradeStart, tradeEnd, hosts) : new Map();
  const costByAsset = {};
  for (const set of tradeSets) {
    if (!set.trades.length) continue;
    const ordered = set.trades.sort((a, b) => Number(a.time) - Number(b.time) || Number(a.id) - Number(b.id));
    const needsDirectRate = ordered.some(trade => trade.quoteAsset !== 'BRL');
    const directRates = needsDirectRate ? await binanceHistoricalCloses(`${set.asset}BRL`, tradeStart, tradeEnd, hosts) : new Map();
    let heldByTrades = 0;
    let costBasis = 0;
    let latestBuy = null;
    let estimated = false;
    for (const trade of ordered) {
      const quantity = Number(trade.qty) || 0;
      if (quantity <= 0) continue;
      const time = Number(trade.time);
      const day = Math.floor(time / 86_400_000) * 86_400_000;
      const fee = Number(trade.commission) || 0;
      const feeAsset = String(trade.commissionAsset || '').toUpperCase();
      if (trade.isBuyer) {
        latestBuy = time;
        const acquired = Math.max(0, quantity - (feeAsset === set.asset ? fee : 0));
        const quoteAmount = Number(trade.quoteQty) || quantity * (Number(trade.price) || 0);
        const quoteRate = trade.quoteAsset === 'BRL' ? 1 : (['USDT', 'USDC', 'FDUSD'].includes(trade.quoteAsset) ? usdtRates.get(day) : null);
        let purchaseCost = quoteAmount > 0 && quoteRate ? quoteAmount * quoteRate : 0;
        if (purchaseCost && feeAsset === trade.quoteAsset) purchaseCost += fee * quoteRate;
        if (!purchaseCost) {
          const historicalPrice = directRates.get(day);
          if (historicalPrice > 0) { purchaseCost = acquired * historicalPrice; estimated = true; }
        } else if (trade.quoteAsset !== 'BRL') estimated = true;
        if (purchaseCost > 0) { heldByTrades += acquired; costBasis += purchaseCost; }
      } else {
        const sold = quantity + (feeAsset === set.asset ? fee : 0);
        const averageCost = heldByTrades > 0 ? costBasis / heldByTrades : 0;
        const removed = Math.min(heldByTrades, sold);
        heldByTrades -= removed;
        costBasis = Math.max(0, costBasis - averageCost * removed);
      }
    }
    let investedBRL = heldByTrades > 0 && costBasis > 0 ? costBasis / heldByTrades * set.balance : 0;
    if ((!Number.isFinite(investedBRL) || investedBRL <= 0) && latestBuy) {
      const priceOnBuyDate = directRates.get(Math.floor(latestBuy / 86_400_000) * 86_400_000);
      if (priceOnBuyDate > 0) { investedBRL = set.balance * priceOnBuyDate; estimated = true; }
    }
    if (Number.isFinite(investedBRL) && investedBRL > 0) costByAsset[set.balanceAsset || set.asset] = {
      investedBRL, purchaseDate: latestBuy ? new Date(latestBuy).toISOString() : null,
      source: estimated ? 'historical-estimate' : 'binance-trades'
    };
  }
  const balancesWithCost = balances.map(balance => ({ ...balance, ...(costByAsset[balance.asset] || {}) }));
  return { configured: true, balances: balancesWithCost, updatedAt: new Date().toISOString() };
}

async function serveStatic(req, res, pathname) {
  const allowed = new Map([['/', 'dashboard.html'], ['/index.html', 'dashboard.html'], ['/app.js', 'app.js'], ['/styles.css', 'styles.css'], ['/vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.min.mjs'], ['/vendor/pdfjs/pdf.worker.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs']]);
  const filename = allowed.get(pathname);
  if (!filename) { res.writeHead(404); res.end('Not found'); return; }
  const filePath = path.join(ROOT, filename);
  try {
    const content = await readFile(filePath);
    const type = filename.endsWith('.html') ? 'text/html; charset=utf-8' : filename.endsWith('.js') || filename.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type, ...securityHeaders() });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}

let applicationHandler;
let applicationStartupError;
let applicationInitialization;

const server = http.createServer(async (req, res) => {
  try {
    await applicationInitialization;
    if (applicationStartupError) {
      send(res, 500, { error: 'Não foi possível inicializar o servidor.' });
      return;
    }
    await applicationHandler(req, res);
  } catch (error) {
    console.error('Falha ao processar requisição:', error);
    if (!res.headersSent) send(res, 500, { error: 'Erro interno.' });
    else res.destroy();
  }
});
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1000;

async function main() {
  await loadDotEnv();
  if (process.env.NODE_ENV === 'production') {
    const configuredOrigin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
    let publicOrigin;
    try { publicOrigin = new URL(configuredOrigin); } catch { throw new Error('Em produção, configure PUBLIC_ORIGIN ou hospede em uma plataforma com URL HTTPS automática.'); }
    if (publicOrigin.protocol !== 'https:' || publicOrigin.origin !== configuredOrigin) throw new Error('PUBLIC_ORIGIN deve ser uma origem HTTPS, sem caminho adicional ou barra final.');
    if (!String(process.env.APP_ENCRYPTION_KEY || '').trim()) throw new Error('Em produção, configure APP_ENCRYPTION_KEY e mantenha uma cópia segura dessa chave.');
  }
  if (!process.env.DATABASE_URL) await mkdir(DATA_DIR, { recursive: true });
  await initializeDatabase();
  applicationHandler = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    try {
      if (pathname.startsWith('/api/') && req.method !== 'GET' && req.method !== 'HEAD' && pathname !== '/api/webhooks/pluggy') {
        if (!requestOriginAllowed(req)) { send(res, 403, { error: 'Origem da requisição não autorizada.' }); return; }
        const hasBody = Number(req.headers['content-length'] || 0) > 0 || Boolean(req.headers['transfer-encoding']);
        if (hasBody && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          send(res, 415, { error: 'Envie o conteúdo usando application/json.' }); return;
        }
      }
      if (req.method === 'GET' && pathname === '/api/session') {
        const session = await currentSession(req);
        const user = session ? await getUser(session.userId) : null;
        send(res, 200, { authenticated: Boolean(session), userId: session?.userId || null, username: session?.username || null, email: user?.email || null, emailVerified: Boolean(user?.emailVerifiedAt), setupRequired: await getUserCount() === 0 });
        return;
      }
      if (req.method === 'POST' && pathname === '/api/setup') {
        const remote = requestAddress(req);
        if (await incrementRateLimit('signup', remote, 15 * 60 * 1000) > 5) { send(res, 429, { error: 'Muitos cadastros deste endereço. Aguarde 15 minutos e tente novamente.' }); return; }
        const body = await readJson(req);
        const username = String(body.username || '').trim();
        const email = normalizeEmail(body.email);
        const password = String(body.password || '');
        if (username.length < 3 || username.length > 40 || !validEmail(email) || password.length < 12 || password.length > 200 || password !== String(body.confirmPassword || '')) { send(res, 400, { error: 'Informe um usuário, e-mail válido e senha de pelo menos 12 caracteres confirmada.' }); return; }
        const salt = randomBytes(16);
        const hash = await pbkdf(password, salt);
        const recoveryCode = randomBytes(18).toString('base64url');
        const recoverySalt = randomBytes(16);
        const recoveryHash = await pbkdf(recoveryCode, recoverySalt);
        const id = randomUUID();
        try {
          await dbRun('INSERT INTO users (id, username, email, salt, password_hash, recovery_salt, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            id, username, email, salt.toString('base64'), hash.toString('base64'), recoverySalt.toString('base64'), recoveryHash.toString('base64'), new Date().toISOString());
        } catch (error) {
          if (error.code === '23505' || String(error.message).includes('UNIQUE')) { send(res, 409, { error: 'Este nome de usuário ou e-mail já está cadastrado.' }); return; }
          throw error;
        }
        await clearRateLimit('auth', remote);
        let emailVerificationSent = false, emailMessage = '';
        try {
          const code = await createEmailCode(id, email, 'verify');
          await sendMail(email, 'Verifique seu e-mail · Minhas Finanças', `Seu código de verificação é ${code}. Ele expira em 15 minutos. Se você não iniciou o cadastro, ignore esta mensagem.`);
          emailVerificationSent = true;
        } catch (error) { emailMessage = error.message || 'Não foi possível enviar o código de verificação.'; }
        await createSession(res, req, await getUser(id), { recoveryCode, emailVerificationSent, emailMessage });
        return;
      }
      if (req.method === 'POST' && pathname === '/api/password-reset/request') {
        const remote = requestAddress(req);
        if ((await getRateLimit('reset-email', remote, 15 * 60 * 1000)).count >= 4) { send(res, 429, { error: 'Muitas solicitações. Aguarde 15 minutos e tente novamente.' }); return; }
        const body = await readJson(req), email = normalizeEmail(body.email);
        if (!validEmail(email)) { send(res, 400, { error: 'Informe um e-mail válido.' }); return; }
        if (!String(process.env.RESEND_API_KEY || '').trim() || !String(process.env.EMAIL_FROM || '').trim()) { send(res, 503, { error: 'Recuperação por e-mail indisponível: configure RESEND_API_KEY e EMAIL_FROM no servidor.' }); return; }
        const auth = await dbGet('SELECT id, email FROM users WHERE lower(email) = lower(?) AND email_verified_at IS NOT NULL', email);
        await incrementRateLimit('reset-email', remote, 15 * 60 * 1000);
        if (auth) {
          try {
            const code = await createEmailCode(auth.id, auth.email, 'reset');
            await sendMail(auth.email, 'Código para redefinir sua senha · Minhas Finanças', `Seu código de redefinição é ${code}. Ele expira em 15 minutos e pode ser usado uma única vez. Se você não solicitou, ignore esta mensagem.`);
          } catch (error) { console.error('Não foi possível enviar o código de recuperação:', error.message); }
        }
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && pathname === '/api/password-reset/email') {
        const remote = requestAddress(req);
        if ((await getRateLimit('auth', remote, 60000)).count >= 6) { send(res, 429, { error: 'Muitas tentativas. Aguarde um minuto e tente novamente.' }); return; }
        const body = await readJson(req), email = normalizeEmail(body.email), code = String(body.code || ''), password = String(body.password || '');
        if (!validEmail(email) || !/^\d{8}$/.test(code) || password.length < 12 || password.length > 200 || password !== String(body.confirmPassword || '')) { send(res, 400, { error: 'Confira o e-mail, o código e a confirmação da senha (mínimo 12 caracteres).' }); return; }
        const auth = await dbGet('SELECT id, email FROM users WHERE lower(email) = lower(?) AND email_verified_at IS NOT NULL', email);
        const reset = auth ? await dbGet('SELECT email, code_hash, expires_at, attempts FROM password_reset_codes WHERE user_id = ?', auth.id) : null;
        const actual = auth && reset && /^\d{8}$/.test(code) ? emailCodeHash(auth.id, code) : '0'.repeat(64);
        const valid = Boolean(reset && reset.email === auth?.email && Number(reset.attempts) < 5 && Date.parse(reset.expires_at) > Date.now() && timingSafeEqual(Buffer.from(actual), Buffer.from(reset.code_hash)));
        if (!valid) {
          if (auth && reset) await dbRun('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE user_id = ?', auth.id);
          await incrementRateLimit('auth', remote, 60000);
          send(res, 401, { error: 'E-mail ou código inválido ou expirado.' }); return;
        }
        const salt = randomBytes(16), hash = await pbkdf(password, salt);
        await dbRun('UPDATE users SET salt = ?, password_hash = ? WHERE id = ?', salt.toString('base64'), hash.toString('base64'), auth.id);
        await dbRun('DELETE FROM password_reset_codes WHERE user_id = ?', auth.id);
        await dbRun('DELETE FROM user_sessions WHERE user_id = ?', auth.id);
        await clearRateLimit('auth', remote);
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && pathname === '/api/password-reset') {
        const remote = requestAddress(req);
        if ((await getRateLimit('auth', remote, 60000)).count >= 6) { send(res, 429, { error: 'Muitas tentativas. Aguarde um minuto e tente novamente.' }); return; }
        const body = await readJson(req);
        const username = String(body.username || '').trim();
        const recoveryCode = String(body.recoveryCode || '');
        const password = String(body.password || '');
        if (password.length < 12 || password.length > 200 || password !== String(body.confirmPassword || '')) { send(res, 400, { error: 'Confirme uma nova senha com pelo menos 12 caracteres.' }); return; }
        const auth = await getUserByUsername(username);
        if (!auth?.recoverySalt || !auth?.recoveryHash) {
          await pbkdf(recoveryCode, DUMMY_PASSWORD_SALT);
          await incrementRateLimit('auth', remote, 60000);
          send(res, 401, { error: 'Usuário ou código de recuperação incorretos.' }); return;
        }
        const candidate = await pbkdf(recoveryCode, Buffer.from(auth.recoverySalt, 'base64'));
        const expected = Buffer.from(auth.recoveryHash, 'base64');
        const matches = candidate.length === expected.length && timingSafeEqual(candidate, expected);
        if (!matches) {
          await incrementRateLimit('auth', remote, 60000);
          send(res, 401, { error: 'Usuário ou código de recuperação incorretos.' });
          return;
        }
        const salt = randomBytes(16);
        const hash = await pbkdf(password, salt);
        await dbRun('UPDATE users SET salt = ?, password_hash = ? WHERE id = ?', salt.toString('base64'), hash.toString('base64'), auth.id);
        await dbRun('DELETE FROM user_sessions WHERE user_id = ?', auth.id);
        await clearRateLimit('auth', remote);
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && pathname === '/api/login') {
        const remote = requestAddress(req);
        if ((await getRateLimit('auth', remote, 60000)).count >= 6) { send(res, 429, { error: 'Muitas tentativas. Aguarde um minuto e tente novamente.' }); return; }
        const body = await readJson(req);
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const auth = await getUserByUsername(username);
        if (!auth) {
          await pbkdf(password, DUMMY_PASSWORD_SALT);
          await incrementRateLimit('auth', remote, 60000);
          send(res, 401, { error: 'Usuário ou senha incorretos.' }); return;
        }
        const candidate = await pbkdf(password, Buffer.from(auth.salt, 'base64'));
        const expected = Buffer.from(auth.hash, 'base64');
        const matches = candidate.length === expected.length && timingSafeEqual(candidate, expected);
        if (!matches) {
          await incrementRateLimit('auth', remote, 60000);
          send(res, 401, { error: 'Usuário ou senha incorretos.' });
          return;
        }
        await clearRateLimit('auth', remote);
        let recoveryCode;
        if (!auth.recoverySalt || !auth.recoveryHash) {
          recoveryCode = randomBytes(18).toString('base64url');
          const recoverySalt = randomBytes(16);
          const recoveryHash = await pbkdf(recoveryCode, recoverySalt);
          await dbRun('UPDATE users SET recovery_salt = ?, recovery_hash = ? WHERE id = ?', recoverySalt.toString('base64'), recoveryHash.toString('base64'), auth.id);
        }
        await createSession(res, req, await getUser(auth.id), recoveryCode ? { recoveryCode } : {});
        return;
      }
      if (req.method === 'POST' && pathname === '/api/logout') {
        const token = getCookie(req, SESSION_COOKIE);
        if (token) await dbRun('DELETE FROM user_sessions WHERE token_hash = ?', sessionHash(token));
        send(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
        return;
      }
      if (req.method === 'POST' && pathname === '/api/webhooks/pluggy') {
        const expectedSecret = process.env.PLUGGY_WEBHOOK_SECRET;
        if (!expectedSecret) { send(res, 503, { error: 'Configure PLUGGY_WEBHOOK_SECRET no servidor.' }); return; }
        if (!matchesWebhookSecret(req.headers['x-webhook-secret'], expectedSecret)) { send(res, 401, { error: 'Webhook não autorizado.' }); return; }
        let event;
        try { event = await readJson(req, 64 * 1024); }
        catch { send(res, 400, { error: 'Payload do webhook inválido.' }); return; }
        const eventName = String(event.event || '');
        const eventId = String(event.eventId || '');
        const itemId = String(event.itemId || '');
        if (!eventName || !eventId || (eventName.startsWith('item/') && !itemId)) { send(res, 400, { error: 'Webhook sem event, eventId ou itemId obrigatório.' }); return; }
        const acceptedEvent = await dbGet('INSERT INTO pluggy_webhook_events (event_id, received_at) VALUES (?, ?) ON CONFLICT(event_id) DO NOTHING RETURNING event_id', eventId, new Date().toISOString());
        if (!acceptedEvent) { send(res, 200, { received: true, duplicate: true }); return; }
        await dbRun('DELETE FROM pluggy_webhook_events WHERE received_at < ?', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
        const webhookWork = handlePluggyWebhook(event).catch(error => console.error(`Falha ao processar evento Pluggy ${eventName} (${eventId}):`, error.message));
        if (process.env.VERCEL) waitUntil(webhookWork);
        send(res, 200, { received: true });
        if (!process.env.VERCEL) setImmediate(() => { void webhookWork; });
        return;
      }
      if (pathname.startsWith('/api/')) {
        const session = await currentSession(req);
        if (!session) { send(res, 401, { error: 'Entre novamente para acessar suas contas.' }); return; }
        if (req.method === 'GET' && pathname === '/api/account/email') {
          const user = await getUser(session.userId);
          send(res, 200, { email: user.email || null, verified: Boolean(user.emailVerifiedAt) });
          return;
        }
        if (req.method === 'POST' && pathname === '/api/account/email/request') {
          const remote = requestAddress(req);
          if ((await getRateLimit('verify-email', remote, 15 * 60 * 1000)).count >= 4) { send(res, 429, { error: 'Muitos códigos solicitados. Aguarde 15 minutos e tente novamente.' }); return; }
          const body = await readJson(req), email = normalizeEmail(body.email);
          if (!validEmail(email)) { send(res, 400, { error: 'Informe um endereço de e-mail válido.' }); return; }
          const existing = await dbGet('SELECT id FROM users WHERE lower(email) = lower(?) AND id <> ?', email, session.userId);
          if (existing) { send(res, 409, { error: 'Este e-mail já está associado a outra conta.' }); return; }
          const code = await createEmailCode(session.userId, email, 'verify');
          await incrementRateLimit('verify-email', remote, 15 * 60 * 1000);
          try { await sendMail(email, 'Verifique seu e-mail · Minhas Finanças', `Seu código de verificação é ${code}. Ele expira em 15 minutos. Se você não solicitou, ignore esta mensagem.`); }
          catch (error) { send(res, error.status || 502, { error: error.message || 'Não foi possível enviar o código de verificação.' }); return; }
          send(res, 200, { ok: true });
          return;
        }
        if (req.method === 'POST' && pathname === '/api/account/email/verify') {
          const body = await readJson(req), email = normalizeEmail(body.email), code = String(body.code || '');
          const pending = await dbGet('SELECT email, code_hash, expires_at, attempts FROM email_verification_codes WHERE user_id = ?', session.userId);
          const actual = /^\d{8}$/.test(code) ? emailCodeHash(session.userId, code) : '';
          const matches = Boolean(pending && pending.email === email && Number(pending.attempts) < 5 && Date.parse(pending.expires_at) > Date.now() && actual && actual.length === pending.code_hash.length && timingSafeEqual(Buffer.from(actual), Buffer.from(pending.code_hash)));
          if (!matches) {
            if (pending) await dbRun('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE user_id = ?', session.userId);
            send(res, 401, { error: 'E-mail ou código inválido ou expirado.' }); return;
          }
          const existing = await dbGet('SELECT id FROM users WHERE lower(email) = lower(?) AND id <> ?', email, session.userId);
          if (existing) { send(res, 409, { error: 'Este e-mail já está associado a outra conta.' }); return; }
          await dbRun('UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?', email, new Date().toISOString(), session.userId);
          await dbRun('DELETE FROM email_verification_codes WHERE user_id = ?', session.userId);
          await dbRun('DELETE FROM password_reset_codes WHERE user_id = ?', session.userId);
          send(res, 200, { ok: true });
          return;
        }
        if (req.method === 'GET' && pathname === '/api/data') {
          const rows = await dbAll('SELECT data_key, value FROM user_data WHERE user_id = ? AND data_key LIKE ?', session.userId, 'browser:%');
          const data = {};
          for (const row of rows) {
            try { data[row.data_key.slice('browser:'.length)] = JSON.parse(row.value); } catch {}
          }
          const marker = await dbGet('SELECT 1 FROM app_meta WHERE key = ?', `legacy_browser_imported:${session.userId}`);
          send(res, 200, { userId: session.userId, username: session.username, data, legacyImportAllowed: session.userId === await getLegacyOwnerId() && !marker });
          return;
        }
        if (req.method === 'POST' && pathname === '/api/data/import-legacy') {
          let body;
          try { body = await readJson(req, 8 * 1024 * 1024); } catch { send(res, 400, { error: 'Dados antigos inválidos ou acima do limite.' }); return; }
          if (session.userId !== await getLegacyOwnerId()) { send(res, 403, { error: 'A importação do navegador antigo pertence à conta original.' }); return; }
          const markerKey = `legacy_browser_imported:${session.userId}`;
          if (!await dbGet('SELECT 1 FROM app_meta WHERE key = ?', markerKey)) {
              const entries = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? Object.entries(body.data) : [];
              for (const [key, value] of entries) {
                if (CLIENT_DATA_KEYS.has(key) && typeof value === 'string' && value.length <= 1500000) await setUserData(session.userId, `browser:${key}`, value);
              }
              await dbRun('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', markerKey, new Date().toISOString());
          }
          send(res, 200, { ok: true });
          return;
        }
        if (pathname.startsWith('/api/data/')) {
          const key = decodeURIComponent(pathname.slice('/api/data/'.length));
          if (!CLIENT_DATA_KEYS.has(key)) { send(res, 404, { error: 'Campo de dados não encontrado.' }); return; }
          if (req.method === 'PUT') {
            let body;
            try { body = await readJson(req, 5 * 1024 * 1024); } catch { send(res, 400, { error: 'O dado enviado é inválido ou excede o limite.' }); return; }
            if (typeof body.value !== 'string') { send(res, 400, { error: 'Valor de dado inválido.' }); return; }
            await setUserData(session.userId, `browser:${key}`, body.value);
            send(res, 200, { ok: true });
            return;
          }
          if (req.method === 'DELETE') {
            await dbRun('DELETE FROM user_data WHERE user_id = ? AND data_key = ?', session.userId, `browser:${key}`);
            send(res, 200, { ok: true });
            return;
          }
        }
        const cryptoRoute = pathname.match(/^\/api\/crypto\/([a-z]+)\/(credentials|account)$/);
        if (cryptoRoute) {
          const provider = cryptoRoute[1];
          const action = cryptoRoute[2];
          const spec = CRYPTO_EXCHANGES[provider];
          if (!spec) { send(res, 404, { error: 'Corretora cripto não disponível.' }); return; }
          const secretName = provider === 'binance' ? 'binance' : 'crypto:' + provider;
          if (action === 'credentials' && req.method === 'GET') {
            const configured = Boolean(await dbGet('SELECT 1 FROM user_secrets WHERE user_id = ? AND secret_name = ?', session.userId, secretName));
            send(res, 200, { configured }); return;
          }
          if (action === 'credentials' && req.method === 'PUT') {
            let body;
            try { body = await readJson(req, 16384); } catch { send(res, 400, { error: 'As credenciais enviadas são inválidas.' }); return; }
            const credentials = {};
            for (const field of spec.fields) { credentials[field] = String(body[field] || '').trim(); const max = field === 'privateKey' ? 12000 : 1000; if (credentials[field].length < 8 || credentials[field].length > max) { send(res, 400, { error: 'Confira os campos exigidos pela corretora e informe valores válidos.' }); return; } }
            await saveUserSecret(session.userId, secretName, JSON.stringify(credentials));
            send(res, 200, { ok: true, configured: true }); return;
          }
          if (action === 'credentials' && req.method === 'DELETE') {
            await dbRun('DELETE FROM user_secrets WHERE user_id = ? AND secret_name = ?', session.userId, secretName);
            send(res, 200, { ok: true, configured: false }); return;
          }
          if (action === 'account' && req.method === 'GET') {
            try { let credentials = {}; try { credentials = JSON.parse(await getUserSecret(session.userId, secretName) || '{}'); } catch {}
              const account = await fetchCryptoExchangeAccount(provider, credentials);
              if (!account.configured) { send(res, 503, { configured: false, error: 'Cadastre as credenciais somente leitura da ' + spec.name + ' nesta conta.' }); return; }
              send(res, 200, account);
            } catch (error) { send(res, error.status || 502, { error: error.message || 'Não foi possível consultar a ' + spec.name + '.' }); }
            return;
          }
          send(res, 405, { error: 'Método não permitido.' }); return;
        }
        if (req.method === 'GET' && pathname === '/api/binance/credentials') {
          const saved = Boolean(await dbGet('SELECT 1 FROM user_secrets WHERE user_id = ? AND secret_name = ?', session.userId, 'binance'));
          send(res, 200, { configured: saved });
          return;
        }
        if (req.method === 'PUT' && pathname === '/api/binance/credentials') {
          let body;
          try { body = await readJson(req, 8192); } catch { send(res, 400, { error: 'As credenciais enviadas são inválidas.' }); return; }
          const apiKey = String(body.apiKey || '').trim();
          const apiSecret = String(body.apiSecret || '').trim();
          if (apiKey.length < 8 || apiKey.length > 300 || apiSecret.length < 8 || apiSecret.length > 300) { send(res, 400, { error: 'Informe a chave e o segredo de API válidos da Binance.' }); return; }
          await saveUserSecret(session.userId, 'binance', JSON.stringify({ apiKey, apiSecret }));
          send(res, 200, { ok: true, configured: true });
          return;
        }
        if (req.method === 'DELETE' && pathname === '/api/binance/credentials') {
          await dbRun('DELETE FROM user_secrets WHERE user_id = ? AND secret_name = ?', session.userId, 'binance');
          send(res, 200, { ok: true, configured: false });
          return;
        }
        if (req.method === 'GET' && pathname === '/api/binance/account') {
          try {
            let credentials = {};
            try { credentials = JSON.parse(await getUserSecret(session.userId, 'binance') || '{}'); } catch {}
            const account = await signedBinanceAccount(credentials.apiKey, credentials.apiSecret);
            if (!account.configured) { send(res, 503, { configured: false, error: 'Cadastre uma chave Binance com permissão somente de leitura nesta conta.' }); return; }
            send(res, 200, account);
          } catch (error) { send(res, error.status || 502, { error: error.message || 'Não foi possível consultar a Binance.' }); }
          return;
        }
        if (req.method === 'GET' && pathname === '/api/brokerages/connectors') {
          try {
            // A Pluggy trial costuma expor Pluggy Bank como sandbox de banco,
            // embora ele também ofereça o produto INVESTMENTS. Buscar sem filtro
            // de tipo evita esconder esse conector e outras instituições com investimentos.
            const data = await pluggyRequest('/connectors?countries=BR&sandbox=true');
            const results = Array.isArray(data.results) ? data.results : Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [];
            const connectors = results.filter(connector =>
              String(connector.type).toUpperCase() === 'INVESTMENT' ||
              (Array.isArray(connector.products) && connector.products.some(product => String(product).toUpperCase() === 'INVESTMENTS'))
            ).map(connector => ({
              id: Number(connector.id), name: String(connector.name || 'Corretora'), imageUrl: String(connector.imageUrl || ''),
              primaryColor: String(connector.primaryColor || ''), sandbox: Boolean(connector.isSandbox), type: String(connector.type || ''),
              products: Array.isArray(connector.products) ? connector.products : [], status: String(connector.health?.status || '')
            })).filter(connector => Number.isFinite(connector.id)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
            send(res, 200, { connectors });
          } catch (error) { send(res, error.status || 502, { error: error.message || 'Não foi possível carregar as corretoras disponíveis.' }); }
          return;
        }
        if (req.method === 'GET' && pathname === '/api/brokerages') {
          send(res, 200, { brokerages: await readBrokerageItems(session.userId) });
          return;
        }
        if (req.method === 'POST' && pathname === '/api/brokerages/item') {
          let body;
          try { body = await readJson(req); } catch { send(res, 400, { error: 'Dados da conexão inválidos.' }); return; }
          const itemId = String(body.itemId || '');
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId)) { send(res, 400, { error: 'Identificador da conexão inválido.' }); return; }
          try {
            const item = await pluggyRequest(`/items/${encodeURIComponent(itemId)}`);
            if (String(item.clientUserId || '') !== session.userId) { send(res, 403, { error: 'Esta conexão Pluggy não pertence a esta conta do painel.' }); return; }
            const connector = item.connector || {};
            let connectorId = Number(connector.id || item.connectorId);
            let connectorType = String(connector.type || item.connectorType || '').toUpperCase();
            let connectorName = openFinanceConnectorName(item);
            if ((!connectorType || !connectorName) && Number.isFinite(connectorId)) {
              const data = await pluggyRequest(`/connectors/${encodeURIComponent(connectorId)}`);
              connectorType ||= String(data.type || '').toUpperCase();
              connectorName ||= String(data.name || '');
            }
            const products = Array.isArray(connector.products) ? connector.products.map(value => String(value).toUpperCase()) : [];
            if ((connectorType !== 'INVESTMENT' && !products.includes('INVESTMENTS')) || !connectorName) { send(res, 400, { error: 'A conexão selecionada não oferece dados de investimentos.' }); return; }
            const brokerages = await readBrokerageItems(session.userId);
            const saved = { itemId, connectorId: Number.isFinite(connectorId) ? connectorId : null, connectorName, connectedAt: new Date().toISOString() };
            const index = brokerages.findIndex(entry => entry.itemId === itemId);
            if (index >= 0) brokerages[index] = saved; else brokerages.push(saved);
            await writeBrokerageItems(session.userId, brokerages);
            send(res, 200, { ok: true, brokerage: saved });
          } catch (error) { send(res, error.status || 502, { error: error.message || 'Não foi possível salvar a corretora.' }); }
          return;
        }
        if (req.method === 'POST' && pathname === '/api/brokerages/sync') {
          let body;
          try { body = await readJson(req); } catch { send(res, 400, { error: 'Dados da sincronização inválidos.' }); return; }
          const saved = (await readBrokerageItems(session.userId)).find(entry => entry.itemId === String(body.itemId || ''));
          if (!saved) { send(res, 404, { error: 'Essa corretora ainda não está conectada.' }); return; }
          try {
            const data = await pluggyRequest(`/investments?itemId=${encodeURIComponent(saved.itemId)}`);
            const investments = (Array.isArray(data.results) ? data.results : []).map(position => ({
              id: String(position.id || ''), name: String(position.name || position.description || position.type || 'Investimento'),
              type: String(position.type || ''), subtype: String(position.subtype || ''), quantity: Number(position.quantity) || 0,
              balance: Number(position.balance ?? position.currentValue ?? position.amount) || 0,
              currencyCode: String(position.currencyCode || 'BRL'), institution: String(position.institution?.name || saved.connectorName)
            }));
            const syncedAt = new Date().toISOString();
            const brokerages = await readBrokerageItems(session.userId);
            const index = brokerages.findIndex(entry => entry.itemId === saved.itemId);
            if (index >= 0) { brokerages[index] = { ...brokerages[index], syncedAt, investments }; await writeBrokerageItems(session.userId, brokerages); }
            send(res, 200, { connectorName: saved.connectorName, syncedAt, investments });
          } catch (error) { send(res, error.status || 502, { error: error.message || `Não foi possível sincronizar ${saved.connectorName}.` }); }
          return;
        }
        if (req.method === 'GET' && pathname === '/api/bradesco/status') {
          const configured = Boolean(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);
          const item = await readBradescoItem(session.userId);
          const webhookState = await getUserData(session.userId, 'pluggy_webhook_state');
          const webhookError = webhookState?.event === 'item/error' && (!item?.itemId || webhookState.itemId === item.itemId) ? ` A Pluggy informou: ${webhookState.error}` : '';
          send(res, 200, { configured, connected: Boolean(configured && item?.itemId), connectorName: item?.connectorName || '', message: configured
            ? (item?.itemId ? `${displayOpenFinanceConnector(item.connectorName || 'Bradesco')} conectado. Sincronize para atualizar suas movimentações.${webhookError}` : `Pronto para conectar. Escolha Bradesco para dados reais ou Pluggy Bank para testar no Sandbox.${webhookError}`)
            : 'Configure PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no .env do servidor para habilitar a conexão.' });
          return;
        }
        if (req.method === 'POST' && (pathname === '/api/connect-token' || pathname === '/api/bradesco/connect-token')) {
          try {
            const accessToken = await createPluggyConnectToken(session.userId);
            send(res, 200, { accessToken });
          } catch (error) { send(res, error.status || 502, { error: error.message || 'Não foi possível iniciar a conexão.' }); }
          return;
        }
        if (req.method === 'POST' && pathname === '/api/bradesco/item') {
          const body = await readJson(req);
          const itemId = String(body.itemId || '');
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId)) {
            send(res, 400, { error: 'Identificador de conexão inválido.' });
            return;
          }
          try {
            const item = await pluggyRequest(`/items/${encodeURIComponent(itemId)}`);
            if (String(item.clientUserId || '') !== session.userId) { send(res, 403, { error: 'Esta conexão Pluggy não pertence a esta conta do painel.' }); return; }
            const connectorName = openFinanceConnectorName(item);
            if (!supportedOpenFinanceConnector(connectorName)) { send(res, 400, { error: 'Selecione Bradesco para dados reais ou Pluggy Bank para testar no Sandbox.' }); return; }
            await writeBradescoItem(session.userId, { itemId, connectorName, connectedAt: new Date().toISOString() });
            send(res, 200, { ok: true, connectorName: displayOpenFinanceConnector(connectorName) });
          } catch (error) { send(res, error.status || 502, { error: error.message || 'Não foi possível confirmar a conexão.' }); return; }
          return;
        }
        if (req.method === 'POST' && pathname === '/api/bradesco/sync') {
          try {
            const savedItem = await readBradescoItem(session.userId);
            if (!savedItem?.itemId) { send(res, 409, { error: 'Conecte o Bradesco ou o Pluggy Bank (Sandbox) antes de sincronizar.' }); return; }
            const item = await pluggyRequest(`/items/${encodeURIComponent(savedItem.itemId)}`);
            const connectorName = openFinanceConnectorName(item) || savedItem.connectorName || '';
            if (!supportedOpenFinanceConnector(connectorName)) {
              send(res, 409, { error: 'A conexão salva não é aceita. Inicie outra e escolha Bradesco ou Pluggy Bank (Sandbox).' });
              return;
            }
            const institutionName = displayOpenFinanceConnector(connectorName);
            const accountData = await pluggyRequest(`/accounts?itemId=${encodeURIComponent(savedItem.itemId)}`);
            const accounts = Array.isArray(accountData.results) ? accountData.results : [];
            const transactionsByAccount = await Promise.all(accounts.map(async account => ({ account, transactions: await listPluggyTransactions(account.id) })));
            const transactions = transactionsByAccount.flatMap(({ account, transactions: entries }) => entries.map(entry => {
              const amount = Math.abs(Number(entry.amount));
              const date = String(entry.date || entry.createdAt || '').slice(0, 10);
              if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
              const rawType = String(entry.type || '').toUpperCase();
              const signedAmount = Number(entry.amount);
              const type = rawType.includes('CREDIT') || rawType === 'INCOME' ? 'income' : rawType.includes('DEBIT') || rawType === 'EXPENSE' ? 'expense' : signedAmount < 0 ? 'expense' : 'income';
              return {
                id: `openfinance-${entry.id}`,
                externalId: `pluggy:${entry.id}`,
                description: String(entry.description || entry.descriptionRaw || `Transação ${institutionName}`).slice(0, 120),
                type,
                category: (typeof entry.category === 'string' ? entry.category : institutionName).slice(0, 60),
                amount,
                date,
                paymentMethod: /bradesco/i.test(institutionName) ? 'bradesco' : 'openfinance-sandbox',
                accountName: String(account.name || account.type || `Conta ${institutionName}`).slice(0, 80)
              };
            }).filter(Boolean));
            send(res, 200, {
              updatedAt: new Date().toISOString(),
              institutionName,
              accounts: accounts.map(account => ({ id: account.id, name: account.name || `Conta ${institutionName}`, type: account.type || '', balance: Number(account.balance) || 0, currencyCode: account.currencyCode || 'BRL' })),
              transactions
            });
          } catch (error) { send(res, error.status || 502, { error: error.message || 'Não foi possível sincronizar o Bradesco.' }); }
          return;
        }
        send(res, 404, { error: 'Rota não encontrada.' });
        return;
      }
      const session = await currentSession(req);
      if (req.method === 'GET' && pathname === '/' && !session) {
        const nonce = randomBytes(18).toString('base64');
        htmlResponse(res, publicPage(nonce), nonce);
        return;
      }
      if (req.method === 'GET' && pathname === '/login') {
        if (session) { res.writeHead(302, { Location: '/' }); res.end(); return; }
        if (await getUserCount() === 0) { res.writeHead(302, { Location: '/register' }); res.end(); return; }
        const nonce = randomBytes(18).toString('base64');
        htmlResponse(res, accessPage('login', nonce), nonce);
        return;
      }
      if (req.method === 'GET' && pathname === '/register') {
        if (session) { res.writeHead(302, { Location: '/' }); res.end(); return; }
        const nonce = randomBytes(18).toString('base64');
        htmlResponse(res, accessPage('register', nonce), nonce);
        return;
      }
      if (req.method === 'GET' && pathname === '/forgot-password') {
        if (session) { res.writeHead(302, { Location: '/' }); res.end(); return; }
        const nonce = randomBytes(18).toString('base64');
        htmlResponse(res, accessPage('forgot', nonce), nonce);
        return;
      }
      if (req.method === 'GET' && pathname === '/account-email') {
        if (!session) { res.writeHead(302, { Location: '/login' }); res.end(); return; }
        const nonce = randomBytes(18).toString('base64');
        htmlResponse(res, accountEmailPage(nonce, await getUser(session.userId)), nonce);
        return;
      }
      if (!session) {
        if (req.method === 'GET' && pathname === '/index.html') {
          const nonce = randomBytes(18).toString('base64');
          htmlResponse(res, publicPage(nonce), nonce);
          return;
        }
        if (req.method === 'GET' && ['index.html', 'app.js', 'styles.css'].includes(pathname.slice(1))) { res.writeHead(302, { Location: '/login' }); res.end(); return; }
        const nonce = randomBytes(18).toString('base64');
        htmlResponse(res, publicPage(nonce), nonce);
        return;
      }
      await serveStatic(req, res, pathname);
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : 500;
      if (!res.headersSent) send(res, status, { error: status === 400 ? 'Requisição inválida.' : 'Erro interno.' });
      else res.destroy();
    }
  };
  if (!process.env.VERCEL) {
    const port = Number(process.env.PORT || 4174);
    const host = process.env.HOST || (process.env.RENDER === 'true' ? '0.0.0.0' : '127.0.0.1');
    await new Promise((resolve, reject) => {
      const onError = error => reject(error);
      server.once('error', onError);
      server.listen(port, host, () => {
        server.off('error', onError);
        console.log(`Minhas Finanças em http://${host}:${port}`);
        resolve();
      });
    });
  }
}

applicationInitialization = main().catch(error => {
  applicationStartupError = error;
  console.error('Falha ao iniciar servidor:', error);
});

export default server;
