import { z } from 'zod';

export const gitHubSourceSchema = z.object({
  forge: z.literal('github'),
  repoName: z.string(),
  ownerName: z.string(),
  url: z.string(),
});

const orcidSourceSchema = z.object({
  forge: z.literal('orcid'),
});

export const sourceSchema = z.union([gitHubSourceSchema, orcidSourceSchema]);
