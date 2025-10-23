import { getContract, type GetContractReturnType, type PublicClient } from 'viem';

import type {
  RepoDriverAbi,
  DripsAbi,
  AddressDriverAbi,
  NftDriverAbi,
  RepoSubAccountDriverAbi,
  RepoDeadlineDriverAbi,
} from '../chains/abis/abiTypes.js';
import type { ContractConfig } from '../core/EventDecoder.js';

/**
 * Contract instances for interacting with the protocol.
 */
export class Contracts {
  public readonly repoDriver: GetContractReturnType<RepoDriverAbi, PublicClient>;
  public readonly drips: GetContractReturnType<DripsAbi, PublicClient>;
  public readonly addressDriver: GetContractReturnType<AddressDriverAbi, PublicClient>;
  public readonly nftDriver: GetContractReturnType<NftDriverAbi, PublicClient>;
  public readonly repoSubAccountDriver: GetContractReturnType<
    RepoSubAccountDriverAbi,
    PublicClient
  >;
  public readonly repoDeadlineDriver: GetContractReturnType<
    RepoDeadlineDriverAbi,
    PublicClient
  >;

  constructor(publicClient: PublicClient, contractConfigs: ReadonlyArray<ContractConfig>) {
    const repoDriver = contractConfigs.find((c) => c.name === 'RepoDriver');
    const drips = contractConfigs.find((c) => c.name === 'Drips');
    const addressDriver = contractConfigs.find((c) => c.name === 'AddressDriver');
    const nftDriver = contractConfigs.find((c) => c.name === 'NftDriver');
    const repoSubAccountDriver = contractConfigs.find((c) => c.name === 'RepoSubAccountDriver');
    const repoDeadlineDriver = contractConfigs.find((c) => c.name === 'RepoDeadlineDriver');

    if (!repoDriver) {
      throw new Error('RepoDriver contract not found in chain config');
    }
    if (!drips) {
      throw new Error('Drips contract not found in chain config');
    }

    if (!addressDriver) {
      throw new Error('AddressDriver contract not found in chain config');
    }

    if (!nftDriver) {
      throw new Error('NftDriver contract not found in chain config');
    }

    if (!repoSubAccountDriver) {
      throw new Error('RepoSubAccountDriver contract not found in chain config');
    }

    if (!repoDeadlineDriver) {
      throw new Error('RepoDeadlineDriver contract not found in chain config');
    }

    this.repoDriver = getContract({
      address: repoDriver.address,
      abi: repoDriver.abi as RepoDriverAbi,
      client: publicClient,
    });

    this.drips = getContract({
      address: drips.address,
      abi: drips.abi as DripsAbi,
      client: publicClient,
    });

    this.addressDriver = getContract({
      address: addressDriver.address,
      abi: addressDriver.abi as AddressDriverAbi,
      client: publicClient,
    });

    this.nftDriver = getContract({
      address: nftDriver.address,
      abi: nftDriver.abi as NftDriverAbi,
      client: publicClient,
    });

    this.repoSubAccountDriver = getContract({
      address: repoSubAccountDriver.address,
      abi: repoSubAccountDriver.abi as RepoSubAccountDriverAbi,
      client: publicClient,
    });

    this.repoDeadlineDriver = getContract({
      address: repoDeadlineDriver.address,
      abi: repoDeadlineDriver.abi as RepoDeadlineDriverAbi,
      client: publicClient,
    });
  }
}
