import type { AccountType } from './splitRules.js';

type MetadataReceiver = {
  weight: number;
  accountId: string;
  type?: string;
  source?: { forge: string };
};

/**
 * Maps metadata receiver type to AccountType.
 * Consolidates logic from handleDripListMetadata, handleEcosystemMainAccountMetadata, and handleSubListMetadata.
 */
export function getReceiverTypeFromMetadata(receiver: MetadataReceiver): AccountType {
  if (!('type' in receiver) || !receiver.type) {
    // Legacy format or missing type field.
    if ('source' in receiver && receiver.source) {
      if (receiver.source.forge === 'orcid') {
        return 'linked_identity';
      }
      return 'project';
    }
    return 'address';
  }

  switch (receiver.type) {
    case 'address':
      return 'address';
    case 'repoDriver':
      return 'project';
    case 'repoSubAccountDriver':
      if ('source' in receiver && receiver.source && receiver.source.forge === 'orcid') {
        return 'linked_identity';
      }
      return 'project';
    case 'dripList':
      return 'drip_list';
    case 'orcid':
      return 'linked_identity';
    case 'subList':
      return 'sub_list';
    default:
      throw new Error(`Unknown receiver type: ${receiver.type}`);
  }
}
