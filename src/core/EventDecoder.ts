import type { Abi, AbiEvent } from 'abitype';
import {
  decodeEventLog,
  toEventSelector,
  toEventSignature,
  type Address,
  type DecodeEventLogReturnType,
  type Hex,
  type Log,
} from 'viem';

import { logger } from '../logger.js';
import type { InsertEventParams } from '../repositories/EventsRepository.js';
import type { EventHandler } from '../handlers/EventHandler.js';

export type EventHandlerConfig = {
  name: string;
  handler: EventHandler;
};

export type ContractConfig = {
  name: string;
  address: Address;
  abi: Abi;
  handlers: ReadonlyArray<EventHandlerConfig>;
};

export type DecodeSkipReason =
  | 'missing_log_fields'
  | 'unknown_event'
  | 'decode_error'
  | 'missing_event_name';

export type DecodedEvent = Omit<InsertEventParams, 'blockTimestamp'>;

export type DecodeResult =
  | { status: 'decoded'; event: DecodedEvent }
  | { status: 'missing_handler'; eventName: string }
  | { status: 'skipped'; reason: DecodeSkipReason; error?: string };

/**
 * Decodes blockchain logs into structured events.
 *
 * **Schema-Chain Binding Guardrail:**
 * Each schema can only be bound to a single chain. This prevents accidental
 * schema reuse across multiple chains, which could lead to data corruption
 * or inconsistent event processing. The binding is enforced at construction
 * time via runtime assertion.
 */
export class EventDecoder {
  private static readonly _schemaBindings = new Map<string, string>();

  private readonly _chainId: string;
  private readonly _schema: string;
  private readonly _contractAddresses: readonly Address[];
  private readonly _handlerIndex: Map<string, Map<string, EventHandler>>;
  private readonly _topicIndex: Map<
    string,
    { handler: EventHandler; abiItem: AbiEvent; eventName: string }
  >;

  constructor(chainId: string, schema: string, contracts: ReadonlyArray<ContractConfig> = []) {
    this._assertSchemaChainBinding(schema, chainId);

    this._chainId = chainId;
    this._schema = schema;

    const { addresses, handlerIndex, topicIndex } = this._buildContractIndexes(contracts);
    this._contractAddresses = addresses;
    this._handlerIndex = handlerIndex;
    this._topicIndex = topicIndex;
  }

  /**
   * Ensures each schema is bound to exactly one chain.
   */
  private _assertSchemaChainBinding(schema: string, chainId: string): void {
    const existing = EventDecoder._schemaBindings.get(schema);

    if (existing !== undefined && existing !== chainId) {
      throw new Error(
        `Schema "${schema}" is already bound to chain ${existing}. Cannot reuse for chain ${chainId}.`,
      );
    }

    EventDecoder._schemaBindings.set(schema, chainId);
  }

  get contractAddresses(): readonly Address[] {
    return this._contractAddresses;
  }

  /**
   * Attempts to decode a log; provides outcome context for downstream handling.
   */
  decode(log: Log): DecodeResult {
    if (
      log.blockNumber === null ||
      log.blockHash === null ||
      log.transactionIndex === null ||
      log.transactionHash === null ||
      log.logIndex === null ||
      log.topics.length === 0
    ) {
      return { status: 'skipped', reason: 'missing_log_fields' };
    }

    const topic0 = log.topics[0] as Hex;
    const normalizedAddress = this._normalizeAddress(log.address);
    const key = `${normalizedAddress}:${topic0}`;
    const indexed = this._topicIndex.get(key);

    if (!indexed) {
      return { status: 'skipped', reason: 'unknown_event' };
    }

    try {
      const { eventName, args } = decodeEventLog({
        abi: [indexed.abiItem],
        data: log.data,
        topics: log.topics,
        strict: true,
      }) as DecodeEventLogReturnType;

      if (!eventName) {
        return { status: 'skipped', reason: 'missing_event_name' };
      }

      return {
        status: 'decoded',
        event: {
          chainId: this._chainId,
          blockNumber: log.blockNumber,
          txIndex: Number(log.transactionIndex),
          logIndex: Number(log.logIndex),
          transactionHash: log.transactionHash,
          blockHash: log.blockHash,
          contractAddress: log.address,
          eventName,
          eventSig: topic0,
          args: (args ?? {}) as Record<string, unknown>,
        },
      };
    } catch (error) {
      const errorMessage = this._extractErrorMessage(error);
      logger.warn('decode_error', {
        schema: this._schema,
        chainId: this._chainId,
        address: log.address,
        blockNumber: log.blockNumber?.toString() ?? 'unknown',
        error: errorMessage,
      });
      return { status: 'skipped', reason: 'decode_error', error: errorMessage };
    }
  }

  /**
   * Resolves handler function for given contract address and event name.
   */
  resolveHandler(address: string, eventName: string): EventHandler {
    const normalizedAddress = this._normalizeAddress(address);
    const handlers = this._handlerIndex.get(normalizedAddress);
    if (!handlers) {
      throw new Error(`No handlers registered for contract ${address}.`);
    }
    const handler = handlers.get(eventName);
    if (!handler) {
      throw new Error(`No handler registered for event ${eventName} on contract ${address}.`);
    }
    return handler;
  }

  /**
   * Builds indexed lookups for contracts, ABIs, and handlers.
   */
  private _buildContractIndexes(contracts: ReadonlyArray<ContractConfig>): {
    addresses: readonly Address[];
    handlerIndex: Map<string, Map<string, EventHandler>>;
    topicIndex: Map<string, { handler: EventHandler; abiItem: AbiEvent; eventName: string }>;
  } {
    const addressSet = new Set<Address>();
    const handlerIndex = new Map<string, Map<string, EventHandler>>();
    const topicIndex = new Map<
      string,
      { handler: EventHandler; abiItem: AbiEvent; eventName: string }
    >();

    for (const contract of contracts) {
      addressSet.add(contract.address);
      const normalizedAddress = this._normalizeAddress(contract.address);

      const handlers = handlerIndex.get(normalizedAddress) ?? new Map<string, EventHandler>();
      for (const eventDefinition of contract.handlers) {
        handlers.set(eventDefinition.name, eventDefinition.handler);

        // Find matching ABI event and compute topic0.
        const abiItem = contract.abi.find(
          (item): item is AbiEvent => item.type === 'event' && item.name === eventDefinition.name,
        );
        if (abiItem) {
          const topic0 = toEventSelector(toEventSignature(abiItem));
          const key = `${normalizedAddress}:${topic0}`;
          topicIndex.set(key, {
            handler: eventDefinition.handler,
            abiItem,
            eventName: eventDefinition.name,
          });
        }
      }
      handlerIndex.set(normalizedAddress, handlers);
    }

    return {
      addresses: [...addressSet],
      handlerIndex,
      topicIndex,
    };
  }

  /**
   * Normalizes address to lowercase for consistent lookups.
   */
  private _normalizeAddress(address: string): string {
    return address.toLowerCase();
  }

  /**
   * Extracts error message from unknown error type.
   */
  private _extractErrorMessage(error: unknown): string {
    if (error instanceof Error && typeof error.message === 'string') {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    try {
      return JSON.stringify(error, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
    } catch {
      return String(error);
    }
  }
}
