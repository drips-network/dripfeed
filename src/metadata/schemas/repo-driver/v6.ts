import z from 'zod';

import { dripListSplitReceiverSchema } from '../nft-driver/v2.js';

import { addressDriverSplitReceiverSchema, repoDriverSplitReceiverSchema } from './v2.js';
import { repoDriverAccountMetadataSchemaV5 } from './v5.js';

export const orcidSplitReceiverSchema = z.object({
  type: z.literal('orcid'),
  weight: z.number(),
  accountId: z.string(),
  orcidId: z.string(),
});

const repoDriverAccountSplitsSchema = z.object({
  maintainers: z.array(addressDriverSplitReceiverSchema),
  dependencies: z.array(
    z.union([
      dripListSplitReceiverSchema,
      repoDriverSplitReceiverSchema,
      addressDriverSplitReceiverSchema,
      orcidSplitReceiverSchema,
    ]),
  ),
});

export const repoDriverAccountMetadataSchemaV6 = repoDriverAccountMetadataSchemaV5.extend({
  splits: repoDriverAccountSplitsSchema,
});
