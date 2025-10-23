import { z } from 'zod';

import {
  addressDriverSplitReceiverSchema,
  repoDriverSplitReceiverSchema,
} from '../repo-driver/v2.js';
import { subListSplitReceiverSchema } from '../immutable-splits-driver/v1.js';
import { repoSubAccountDriverSplitReceiverSchema } from '../common/repoSubAccountDriverSplitReceiverSchema.js';
import { emojiAvatarSchema } from '../repo-driver/v4.js';

import { dripListSplitReceiverSchema } from './v2.js';
import { nftDriverAccountMetadataSchemaV5 } from './v5.js';

const base = nftDriverAccountMetadataSchemaV5
  .omit({
    isDripList: true,
    projects: true,
  })
  .extend({
    allowExternalDonations: z.boolean().optional(),
  });

const ecosystemVariant = base.extend({
  type: z.literal('ecosystem'),
  recipients: z.array(
    z.union([repoSubAccountDriverSplitReceiverSchema, subListSplitReceiverSchema]),
  ),
  color: z.string(),
  avatar: emojiAvatarSchema,
});

const dripListVariant = base.extend({
  type: z.literal('dripList'),
  recipients: z.array(
    z.union([
      repoDriverSplitReceiverSchema,
      subListSplitReceiverSchema,
      addressDriverSplitReceiverSchema,
      dripListSplitReceiverSchema,
    ]),
  ),
});

export const nftDriverAccountMetadataSchemaV7 = z.discriminatedUnion('type', [
  ecosystemVariant,
  dripListVariant,
]);
