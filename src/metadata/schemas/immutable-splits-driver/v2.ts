import z from 'zod';

import { addressDriverSplitReceiverSchema } from '../repo-driver/v2.js';
import { dripListSplitReceiverSchema } from '../nft-driver/v2.js';
import { repoSubAccountDriverSplitReceiverSchema } from '../common/repoSubAccountDriverSplitReceiverSchema.js';
import { deadlineSplitReceiverSchema } from '../repo-driver/v6.js';

import { subListSplitReceiverSchema, subListMetadataSchemaV1 } from './v1.js';

export const subListMetadataSchemaV2 = subListMetadataSchemaV1.extend({
  recipients: z.array(
    z.union([
      addressDriverSplitReceiverSchema,
      dripListSplitReceiverSchema,
      repoSubAccountDriverSplitReceiverSchema,
      subListSplitReceiverSchema,
      deadlineSplitReceiverSchema, // New in v2
    ]),
  ),
  isVisible: z.boolean().optional(),
});
