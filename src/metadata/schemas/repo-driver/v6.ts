import z from 'zod';

import { gitHubSourceSchema } from '../common/sources.js';
import { dripListSplitReceiverSchema } from '../nft-driver/v2.js';

import { addressDriverSplitReceiverSchema, repoDriverSplitReceiverSchema } from './v2.js';
import { repoDriverAccountMetadataSchemaV5 } from './v5.js';

export const orcidSplitReceiverSchema = z.object({
  type: z.literal('orcid'),
  weight: z.number(),
  accountId: z.string(),
  orcidId: z.string(),
});

export const deadlineSplitReceiverSchema = z.object({
  type: z.literal('deadline'),
  weight: z.number(),
  accountId: z.string(),
  claimableProject: z.object({
    accountId: z.string(),
    source: gitHubSourceSchema,
  }),
  recipientAccountId: z.string(),
  refundAccountId: z.string(),
  deadline: z.coerce
    .date()
    .refine((date) => !Number.isNaN(date.getTime()), 'Invalid date')
    .refine((date) => date > new Date(), 'Deadline must be in the future')
    .refine(
      (date) => date < new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      'Deadline cannot be more than 1 year in the future',
    ),
});

const repoDriverAccountSplitsSchemaV6 = z.object({
  maintainers: z.array(addressDriverSplitReceiverSchema),
  dependencies: z.array(
    z.union([
      dripListSplitReceiverSchema,
      repoDriverSplitReceiverSchema,
      addressDriverSplitReceiverSchema,
      deadlineSplitReceiverSchema, // New in v6
      orcidSplitReceiverSchema, // New in v6
    ]),
  ),
});

export const repoDriverAccountMetadataSchemaV6 = repoDriverAccountMetadataSchemaV5.extend({
  splits: repoDriverAccountSplitsSchemaV6,
});
