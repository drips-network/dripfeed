import type { AnyVersion } from '@efstajas/versioned-parser';
import type z from 'zod';

import { logger } from '../logger.js';
import {
  repoDriverAccountMetadataParser,
  nftDriverAccountMetadataParser,
  immutableSplitsDriverMetadataParser,
} from '../metadata/schemas/index.js';
import type { gitHubSourceSchema } from '../metadata/schemas/common/sources.js';

export type RepoDriverAccountMetadata = AnyVersion<typeof repoDriverAccountMetadataParser>;
export type ProjectMetadata = AnyVersion<typeof repoDriverAccountMetadataParser> & {
  source: z.infer<typeof gitHubSourceSchema>;
};
export type NftDriverAccountMetadata = AnyVersion<typeof nftDriverAccountMetadataParser>;
export type ImmutableSplitsDriverMetadata = AnyVersion<typeof immutableSplitsDriverMetadataParser>;

export type DripListMetadata =
  | Extract<NftDriverAccountMetadata, { type: 'dripList'; recipients: unknown }>
  | Extract<NftDriverAccountMetadata, { isDripList: true }>;

export type EcosystemMainAccountMetadata = Extract<
  NftDriverAccountMetadata,
  { type: 'ecosystem'; recipients: unknown }
>;

export type SubListMetadata = Extract<
  ImmutableSplitsDriverMetadata,
  { type: 'subList'; recipients: unknown }
>;

// TODO: cache results to avoid repeated fetches of the same CID when re-indexing.
export class MetadataService {
  private readonly _gatewayUrl: string;

  constructor(gatewayUrl: string) {
    this._gatewayUrl = gatewayUrl;
  }

  async getProjectMetadata(cId: string): Promise<ProjectMetadata> {
    try {
      const response = await this._fetchIpfsFile(cId);
      const ipfsFile = await response.json();
      const metadata = repoDriverAccountMetadataParser.parseAny(ipfsFile);

      logger.info('project_metadata_retrieved', {
        ipfsHash: cId,
        accountId: metadata.describes?.accountId,
        metadata,
      });

      this._assertIsGitHubProjectMeta(metadata);

      return metadata;
    } catch (error) {
      logger.error('failed_to_fetch_project_metadata', {
        ipfsHash: cId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to fetch project metadata from IPFS: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getNftDriverAccountMetadata(cId: string): Promise<NftDriverAccountMetadata> {
    try {
      const response = await this._fetchIpfsFile(cId);
      const ipfsFile = await response.json();
      const metadata = nftDriverAccountMetadataParser.parseAny(ipfsFile);

      logger.info('nft_driver_account_metadata_retrieved', {
        ipfsHash: cId,
        accountId: metadata.describes?.accountId,
        metadata,
      });

      return metadata;
    } catch (error) {
      logger.error('failed_to_fetch_nft_driver_account_metadata', {
        ipfsHash: cId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to fetch NFT driver account metadata from IPFS: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  isEcosystemMainAccountMetadata(
    metadata: NftDriverAccountMetadata,
  ): metadata is EcosystemMainAccountMetadata {
    return 'type' in metadata && metadata.type === 'ecosystem';
  }

  isDripListMetadata(metadata: NftDriverAccountMetadata): metadata is DripListMetadata {
    return (
      ('isDripList' in metadata && metadata.isDripList) ||
      ('type' in metadata && metadata.type === 'dripList')
    );
  }

  async getImmutableSplitsDriverMetadata(cId: string): Promise<ImmutableSplitsDriverMetadata> {
    try {
      const response = await this._fetchIpfsFile(cId);
      const ipfsFile = await response.json();
      const metadata = immutableSplitsDriverMetadataParser.parseAny(ipfsFile);

      logger.info('immutable_splits_driver_metadata_retrieved', {
        ipfsHash: cId,
        metadata,
      });

      return metadata;
    } catch (error) {
      logger.error('failed_to_fetch_immutable_splits_driver_metadata', {
        ipfsHash: cId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to fetch immutable splits driver metadata from IPFS: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private _validateCid(cId: string): void {
    // IPFS CIDv0: Qm + 44 base58 characters (46 total).
    const cidV0Pattern = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
    // IPFS CIDv1: b + base32 characters.
    const cidV1Pattern = /^b[a-z2-7]{58,}$/;

    if (!cidV0Pattern.test(cId) && !cidV1Pattern.test(cId)) {
      throw new Error(`Invalid IPFS CID format: ${cId}`);
    }

    // Additional check: prevent directory traversal.
    if (cId.includes('..') || cId.includes('/') || cId.includes('\\')) {
      throw new Error(`CID contains invalid characters: ${cId}`);
    }
  }

  private async _fetchIpfsFile(cId: string): Promise<Response> {
    this._validateCid(cId);
    const url = `${this._gatewayUrl}/ipfs/${cId}`;
    logger.info('fetching_ipfs_file', { cId, url });

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch IPFS file: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  private _assertIsGitHubProjectMeta(
    metadata: AnyVersion<typeof repoDriverAccountMetadataParser>,
  ): asserts metadata is ProjectMetadata {
    if (metadata.source.forge !== 'github') {
      throw new Error(`Expected GitHub project metadata but got forge: ${metadata.source.forge}`);
    }
  }
}
