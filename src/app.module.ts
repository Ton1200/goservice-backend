import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { join } from 'path';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env-validation.schema';
import { SystemStatusModule } from './system-status/system-status.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
      validationSchema: envValidationSchema,
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // Code-first GraphQL authoring for this pilot: types/resolvers are
      // TypeScript classes/decorators, and the SDL below is generated from
      // them rather than hand-written. Chosen because it keeps a single
      // source of truth (TypeScript) for a small, infra-only pilot schema
      // and avoids a codegen step. This is a pilot-scoped choice, not the
      // ADR-level decision tracked as open in ADR 0002/graphql-contract.md
      // ("code-first vs schema-first") — a real ADR is still needed before
      // the first GoService domain module is built on GraphQL.
      autoSchemaFile: join(process.cwd(), 'src', 'schema.gql'),
      sortSchema: true,
    }),
    SystemStatusModule,
  ],
})
export class AppModule {}
