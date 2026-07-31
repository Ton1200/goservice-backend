import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Ensures NestJS forwards OS shutdown signals (SIGINT/SIGTERM — e.g.
  // Ctrl+C, `docker stop`) into the module lifecycle, so `OnModuleDestroy`
  // hooks (e.g. DatabaseService closing its `pg.Pool`, PrismaService
  // disconnecting) actually run instead of the process exiting with
  // connections left open.
  app.enableShutdownHooks();

  // Mass-assignment defense (GOS-22): rejects any GraphQL input field not
  // explicitly declared on its DTO (`forbidNonWhitelisted`), strips
  // unknown properties otherwise (`whitelist`), and applies class-transformer
  // coercion (`transform`) so class-validator decorators see the right
  // runtime types.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const configService = app.get(ConfigService<AppConfig, true>);
  const port = configService.get('port', { infer: true });

  // Local-pilot CORS: the Expo Web dev server (a real browser) enforces
  // CORS, unlike curl/Jest/Node scripts, which is why this gap survived
  // earlier validation passes. Scoped to an explicit localhost allowlist
  // (see `config/configuration.ts`) rather than `origin: true`/`'*'`: this
  // is more honest about what the pilot actually needs, and keeps the door
  // closed for `credentials: true` (cookies/auth) being added later without
  // someone having to first widen an already-permissive `*`.
  const corsAllowedOrigins = configService.get('corsAllowedOrigins', {
    infer: true,
  });
  app.enableCors({ origin: corsAllowedOrigins });

  await app.listen(port);
  logger.log(`GoService backend pilot listening on http://localhost:${port}`);
  logger.log(`GraphQL endpoint: http://localhost:${port}/graphql`);
}

void bootstrap();
