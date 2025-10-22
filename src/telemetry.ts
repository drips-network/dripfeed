import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { trace, metrics, type Tracer, type Meter } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';

const URL_SANITIZATION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // API paths
  { pattern: /\/v3\/[^/?#]+/gi, replacement: '/v3/***' },
  { pattern: /\/v2\/[^/?#]+/gi, replacement: '/v2/***' },

  // Query parameters
  {
    pattern: /([?&])(apiKey|api_key|token|key|access_token|secret|auth)=[^&]*/gi,
    replacement: '$1$2=***',
  },

  // HTTP Basic Auth (https://user:pass@host)
  { pattern: /\/\/([^:]+):([^@]+)@/gi, replacement: '//***:***@' },
];

function sanitizeUrl(url: string): string {
  let sanitized = url;
  for (const { pattern, replacement } of URL_SANITIZATION_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

class SanitizingSpanProcessor extends SimpleSpanProcessor {
  constructor(exporter: SpanExporter) {
    super(exporter);
  }

  override onEnd(span: ReadableSpan): void {
    // Sanitize URL attributes in place.
    const attributes = span.attributes;

    // Sanitize url.full attribute (e.g., https://mainnet.infura.io/v3/<key>).
    if (typeof attributes['url.full'] === 'string') {
      attributes['url.full'] = sanitizeUrl(attributes['url.full']);
    }

    // Sanitize url.path attribute (e.g., /v3/<key>).
    if (typeof attributes['url.path'] === 'string') {
      attributes['url.path'] = sanitizeUrl(attributes['url.path']);
    }

    // Sanitize url.query attribute (e.g., apiKey=<key>).
    if (typeof attributes['url.query'] === 'string') {
      attributes['url.query'] = sanitizeUrl(attributes['url.query']);
    }

    super.onEnd(span);
  }
}

export function initTelemetry(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const serviceName = process.env.OTEL_SERVICE_NAME;
  const debugMode = process.env.OTEL_DEBUG === 'true';

  if (endpoint === undefined && !debugMode) {
    console.warn('OTEL_EXPORTER_OTLP_ENDPOINT is not set. Skipping telemetry initialization.');
  }
  if (serviceName === undefined) {
    console.warn('OTEL_SERVICE_NAME is not set. Skipping telemetry initialization.');
  }

  const requiredEnvVarsSet = (endpoint !== undefined || debugMode) && serviceName !== undefined;

  if (!requiredEnvVarsSet) {
    console.error('⚠️  TELEMETRY DISABLED: Missing required environment variables');
    console.error('    Required: OTEL_SERVICE_NAME');
    console.error(
      '    Required: OTEL_EXPORTER_OTLP_ENDPOINT (or set OTEL_DEBUG=true for local testing)',
    );
    console.error('    Production observability will not be available!');
    return;
  }

  const metricInterval = parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL || '60000', 10);

  const spanExporter = debugMode
    ? new ConsoleSpanExporter()
    : new OTLPTraceExporter({
        url: `${endpoint}/v1/traces`,
        headers: {},
      });

  const metricExporter = debugMode
    ? new ConsoleMetricExporter()
    : new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
        headers: {},
      });

  const sanitizingProcessor = new SanitizingSpanProcessor(spanExporter);

  console.log(
    debugMode ? 'Telemetry initialized (DEBUG MODE):' : 'Telemetry initialized:',
    debugMode
      ? { serviceName, metricInterval, mode: 'console' }
      : {
          endpoint: `${endpoint}/v1/traces`,
          serviceName,
          metricInterval,
          resourceAttributes: process.env.OTEL_RESOURCE_ATTRIBUTES,
        },
  );

  const sdk = new NodeSDK({
    autoDetectResources: true,
    serviceName,
    spanProcessors: [sanitizingProcessor],
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: metricInterval,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-pg': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

export function getTracer(): Tracer {
  return trace.getTracer('indexer', '1.0.0');
}

export function getMeter(): Meter {
  return metrics.getMeter('indexer', '1.0.0');
}
