import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyReplyFrom from '@fastify/reply-from';
import { GlobalExceptionFilter, createLogger } from '@ipms/observability';
import { AppModule } from './app.module.js';
import { registerPassthroughBodyParser } from './proxy/passthrough-body.js';
import { extractToken, verifyToken } from '@ipms/authz';

const log = createLogger('gateway');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Identifies the rate-limit bucket for a request.
 *
 * Deliberately does its own cheap token read rather than using `req.user`.
 * `@fastify/rate-limit` runs as an `onRequest` hook, which fires long before
 * Nest's guards populate `req.user` — keying on it would silently collapse
 * every authenticated caller into the per-IP bucket, which matters because a
 * whole field team behind one site's NAT shares an IP.
 *
 * Signature verification here is intentionally *not* authentication: it does
 * not check revocation and its failure does not reject the request. It only
 * decides which bucket to count against, and falls back to the IP when the
 * token is absent or unverifiable.
 */
function rateLimitKey(secret: string, req: { headers: Record<string, string | string[] | undefined>; ip: string; url?: string }): string {
  if (req.url === '/api/v1/auth/login') return `auth_login:${req.ip}`;
  const token = extractToken(req);
  if (token) {
    try {
      return `user:${verifyToken(token, secret, 'access').sub}`;
    } catch {
      // fall through to the IP bucket
    }
  }
  return `ip:${req.ip}`;
}

async function bootstrap(): Promise<void> {
  const jwtSecret = requireEnv('JWT_SECRET');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: true },
  );

  // Streams both directions, so a photo upload from the field app is never
  // buffered in gateway memory. Registered here because the plugin decorates
  // the Fastify reply that ProxyController calls `.from()` on.
  await app.register(fastifyReplyFrom, {
    // Upstreams are other containers on the compose network; a request that
    // hangs must not hold a gateway connection open indefinitely.
    undici: { headersTimeout: 30_000, bodyTimeout: 60_000 },
  });

  // Fastify answers 415 to any content type it has no parser for, which killed
  // every multipart upload at the edge. See the module for the full reasoning.
  registerPassthroughBodyParser(app.getHttpAdapter().getInstance());

  await app.register(fastifyCookie, { secret: requireEnv('COOKIE_SECRET') });
  await app.register(fastifyHelmet, { contentSecurityPolicy: false });
  const defaultMax = Number(process.env['RATE_LIMIT_MAX'] ?? 300);
  await app.register(fastifyRateLimit, {
    max: (req) => {
      // Sensitive auth endpoints carry strict limits to prevent credential stuffing.
      if (req.url === '/api/v1/auth/login' && req.method === 'POST') {
        return 10;
      }
      if (req.url === '/api/v1/auth/refresh' && req.method === 'POST') {
        return 30;
      }
      // Sensitive profile mutations carry a tighter bucket to prevent abuse.
      if (req.url?.startsWith('/api/v1/users/me') && req.method === 'PATCH') {
        return 20;
      }
      return defaultMax;
    },
    timeWindow: '1 minute',
    keyGenerator: (req) => rateLimitKey(jwtSecret, req as never),
    // Health probes must never be rate limited, or a throttled gateway gets
    // killed by its own orchestrator during the incident it is reporting.
    allowList: (req) => req.url === '/health/live' || req.url === '/health/ready',
  });

  app.enableCors({
    origin: (process.env['CORS_ORIGINS'] ?? 'http://localhost:3100').split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  app.useGlobalFilters(new GlobalExceptionFilter('gateway'));
  app.enableShutdownHooks();

  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'gateway listening');
}

bootstrap().catch((err: unknown) => {
  log.fatal({ err }, 'gateway failed to start');
  process.exit(1);
});
