/**
 * Account types for split receivers.
 */
export const ACCOUNT_TYPES = [
  'project',
  'address',
  'drip_list',
  'linked_identity',
  'ecosystem_main_account',
  'sub_list',
  'deadline',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * Relationship types between sender and receiver.
 */
export const RELATIONSHIP_TYPES = [
  'project_maintainer',
  'project_dependency',
  'drip_list_receiver',
  'ecosystem_receiver',
  'sub_list_link',
  'sub_list_receiver',
  'identity_owner',
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/**
 * Valid split receiver combinations.
 * Defines allowed sender/receiver/relationship type triplets.
 */
export const SPLIT_RULES = Object.freeze([
  // Project Rules
  {
    sender_account_type: 'project',
    receiver_account_type: 'address',
    relationship_type: 'project_maintainer',
  },
  {
    sender_account_type: 'project',
    receiver_account_type: 'project',
    relationship_type: 'project_dependency',
  },
  {
    sender_account_type: 'project',
    receiver_account_type: 'address',
    relationship_type: 'project_dependency',
  },
  {
    sender_account_type: 'project',
    receiver_account_type: 'drip_list',
    relationship_type: 'project_dependency',
  },
  {
    sender_account_type: 'project',
    receiver_account_type: 'linked_identity',
    relationship_type: 'project_dependency',
  },
  {
    sender_account_type: 'project',
    receiver_account_type: 'deadline',
    relationship_type: 'project_dependency',
  },

  // Drip List Rules
  {
    sender_account_type: 'drip_list',
    receiver_account_type: 'address',
    relationship_type: 'drip_list_receiver',
  },
  {
    sender_account_type: 'drip_list',
    receiver_account_type: 'drip_list',
    relationship_type: 'drip_list_receiver',
  },
  {
    sender_account_type: 'drip_list',
    receiver_account_type: 'project',
    relationship_type: 'drip_list_receiver',
  },
  {
    sender_account_type: 'drip_list',
    receiver_account_type: 'linked_identity',
    relationship_type: 'drip_list_receiver',
  },
  {
    sender_account_type: 'drip_list',
    receiver_account_type: 'deadline',
    relationship_type: 'drip_list_receiver',
  },

  // Ecosystem Main Account Rules
  {
    sender_account_type: 'ecosystem_main_account',
    receiver_account_type: 'project',
    relationship_type: 'ecosystem_receiver',
  },
  {
    sender_account_type: 'ecosystem_main_account',
    receiver_account_type: 'linked_identity',
    relationship_type: 'ecosystem_receiver',
  },
  {
    sender_account_type: 'ecosystem_main_account',
    receiver_account_type: 'deadline',
    relationship_type: 'ecosystem_receiver',
  },
  {
    sender_account_type: 'ecosystem_main_account',
    receiver_account_type: 'sub_list',
    relationship_type: 'sub_list_link',
  },

  // Sub List Rules
  {
    sender_account_type: 'sub_list',
    receiver_account_type: 'address',
    relationship_type: 'sub_list_receiver',
  },
  {
    sender_account_type: 'sub_list',
    receiver_account_type: 'drip_list',
    relationship_type: 'sub_list_receiver',
  },
  {
    sender_account_type: 'sub_list',
    receiver_account_type: 'project',
    relationship_type: 'sub_list_receiver',
  },
  {
    sender_account_type: 'sub_list',
    receiver_account_type: 'deadline',
    relationship_type: 'sub_list_link',
  },
  {
    sender_account_type: 'sub_list',
    receiver_account_type: 'sub_list',
    relationship_type: 'sub_list_link',
  },
  {
    sender_account_type: 'sub_list',
    receiver_account_type: 'linked_identity',
    relationship_type: 'sub_list_receiver',
  },

  // Linked Identity Rules
  {
    sender_account_type: 'linked_identity',
    receiver_account_type: 'address',
    relationship_type: 'identity_owner',
  },
] as const);
