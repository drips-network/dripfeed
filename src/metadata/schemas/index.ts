import { createVersionedParser } from '@efstajas/versioned-parser';

import { addressDriverAccountMetadataSchemaV1 } from './address-driver/v1.js';
import { nftDriverAccountMetadataSchemaV1 } from './nft-driver/v1.js';
import { nftDriverAccountMetadataSchemaV2 } from './nft-driver/v2.js';
import { nftDriverAccountMetadataSchemaV3 } from './nft-driver/v3.js';
import { repoDriverAccountMetadataSchemaV1 } from './repo-driver/v1.js';
import { repoDriverAccountMetadataSchemaV2 } from './repo-driver/v2.js';
import { repoDriverAccountMetadataSchemaV3 } from './repo-driver/v3.js';
import { repoDriverAccountMetadataSchemaV4 } from './repo-driver/v4.js';
import { nftDriverAccountMetadataSchemaV4 } from './nft-driver/v4.js';
import { repoDriverAccountMetadataSchemaV5 } from './repo-driver/v5.js';
import { nftDriverAccountMetadataSchemaV5 } from './nft-driver/v5.js';
import { subListMetadataSchemaV1 } from './immutable-splits-driver/v1.js';
import { nftDriverAccountMetadataSchemaV6 } from './nft-driver/v6.js';
import { nftDriverAccountMetadataSchemaV7 } from './nft-driver/v7.js';
import { repoDriverAccountMetadataSchemaV6 } from './repo-driver/v6.js';
import { subListMetadataSchemaV2 } from './immutable-splits-driver/v2.js';

export const nftDriverAccountMetadataParser = createVersionedParser([
  nftDriverAccountMetadataSchemaV7.parse,
  nftDriverAccountMetadataSchemaV6.parse,
  nftDriverAccountMetadataSchemaV5.parse,
  nftDriverAccountMetadataSchemaV4.parse,
  nftDriverAccountMetadataSchemaV3.parse,
  nftDriverAccountMetadataSchemaV2.parse,
  nftDriverAccountMetadataSchemaV1.parse,
]);

export const addressDriverAccountMetadataParser = createVersionedParser([
  addressDriverAccountMetadataSchemaV1.parse,
]);

export const repoDriverAccountMetadataParser = createVersionedParser([
  repoDriverAccountMetadataSchemaV6.parse,
  repoDriverAccountMetadataSchemaV5.parse,
  repoDriverAccountMetadataSchemaV4.parse,
  repoDriverAccountMetadataSchemaV3.parse,
  repoDriverAccountMetadataSchemaV2.parse,
  repoDriverAccountMetadataSchemaV1.parse,
]);

export const immutableSplitsDriverMetadataParser = createVersionedParser([
  subListMetadataSchemaV2.parse,
  subListMetadataSchemaV1.parse,
]);
