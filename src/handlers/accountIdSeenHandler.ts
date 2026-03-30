import { fromHex, type DecodeEventLogReturnType } from 'viem';

import type { RepoDriverAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';
import { mapForge, forgeToUrl } from '../utils/forgeUtils.js';
import { isOrcidAccount, isProject } from '../utils/repoDriverAccountUtils.js';
import { toEventPointer } from '../repositories/types.js';
import { insertIgnore } from '../db/db.js';
import {
  projectSchema,
  type Project,
  type ProjectStatus,
  linkedIdentitySchema,
  type LinkedIdentity,
  type LinkedIdentityType,
} from '../db/schemas.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

type AccountIdSeenEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<RepoDriverAbi, 'AccountIdSeen'>['args'];
};

export const accountIdSeenHandler: EventHandler<AccountIdSeenEvent> = async (event, ctx) => {
  const { accountId, sourceId, name } = event.args;
  const { client, schema } = ctx;
  const eventPointer = toEventPointer(event);
  const accountIdStr = accountId.toString();
  const nameStr = fromHex(name, 'string');

  if (isProject(accountIdStr)) {
    const forgeValue = mapForge(Number(sourceId));
    const { entity: project, created } = await insertIgnore<Project>({
      client,
      table: `${schema}.projects`,
      data: {
        account_id: accountIdStr,
        forge: forgeValue,
        name: nameStr,
        url: forgeToUrl(forgeValue, nameStr),
        owner_address: null,
        owner_account_id: null,
        verification_status: 'unclaimed' as ProjectStatus,
        is_valid: true,
        is_visible: true,
        last_event_block: eventPointer.last_event_block,
        last_event_tx_index: eventPointer.last_event_tx_index,
        last_event_log_index: eventPointer.last_event_log_index,
      },
      conflictColumns: ['account_id'],
      schema: projectSchema,
    });

    if (created) {
      logger.info('account_id_seen_project_created', { project });
    } else {
      logger.info('account_id_seen_project_exists', { project });
    }
  } else if (isOrcidAccount(accountIdStr)) {
    const { entity: linkedIdentity, created } = await insertIgnore<LinkedIdentity>({
      client,
      table: `${schema}.linked_identities`,
      data: {
        account_id: accountIdStr,
        identity_type: 'orcid' as LinkedIdentityType,
        owner_address: null,
        owner_account_id: null,
        are_splits_valid: false,
        is_visible: true,
        last_event_block: eventPointer.last_event_block,
        last_event_tx_index: eventPointer.last_event_tx_index,
        last_event_log_index: eventPointer.last_event_log_index,
      },
      conflictColumns: ['account_id'],
      schema: linkedIdentitySchema,
    });

    if (created) {
      logger.info('account_id_seen_linked_identity_created', { linkedIdentity });
    } else {
      logger.info('account_id_seen_linked_identity_exists', { linkedIdentity });
    }
  } else {
    logger.warn('account_id_seen_unsupported_account', { accountId: accountIdStr });
  }
};
