import { accountSchemas } from '../../../../shared/contracts/accounts';
import { geographySchemas } from '../../../../shared/contracts/geography';
import { mapSchemas } from '../../../../shared/contracts/maps';
import { metadataSchemas } from '../../../../shared/contracts/metadata';
import { slaSchemas } from '../../../../shared/contracts/sla';
import { liveSchemas } from '../../../../shared/contracts/live';
import { object, ref, string } from '../../../../shared/contracts/schema';
import { publicPaths, accountPaths, operationalPaths } from './paths';

/** Single executable contract source. The public endpoint and checked-in JSON
 * are generated from these same small modules, so installed clients can inspect it. */
export const openApiDocument = {
  openapi: '3.1.1',
  info: {
    title: 'TTCStatus API',
    version: '1.1.0',
    description:
      'Public transit data and owner-scoped account documents. Device GPS and GPS-derived grid keys remain local. Responses evolve additively within v1.',
  },
  servers: [{ url: 'https://ttcstatus.ca' }],
  paths: { ...publicPaths, ...accountPaths, ...operationalPaths },
  components: {
    securitySchemes: {
      ClerkSession: { type: 'http', scheme: 'bearer', bearerFormat: 'Clerk session JWT' },
      OperatorToken: {
        type: 'http',
        scheme: 'bearer',
        description: 'Private deployment operator credential.',
      },
    },
    schemas: {
      Error: object({ error: string, message: string, guidance: string }, ['error']),
      ...accountSchemas,
      ...geographySchemas,
      ...mapSchemas,
      ...liveSchemas,
      ...metadataSchemas,
      ...slaSchemas,
    },
    responses: {
      Error: {
        description: 'Opaque error code; optional human-readable context.',
        content: { 'application/json': { schema: ref('Error') } },
      },
    },
  },
};
