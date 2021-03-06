import { Options } from './types'

export const defaultOptions: Options = {
  debug: false,
  baseUrl: 'https://config.ff.harness.io/api/1.0',
  eventUrl: 'https://events.ff.harness.io/api/1.0',
  streamEnabled: true,
  allAttributesPrivate: false,
  privateAttributeNames: []
}

// tslint:disable-next-line:no-console
export const logError = (message: string, ...args: any[]) => console.error(`[FF-SDK] ${message}`, ...args)

export const METRICS_FLUSH_INTERVAL = 30 * 1000 // Flush metrics every 30 seconds