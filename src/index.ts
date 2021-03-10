import jwt_decode from 'jwt-decode'
import mitt from 'mitt'
import { EventSourcePolyfill } from 'event-source-polyfill'
import { Options, Target, StreamEvent, Event, EventCallback, Result, Evaluation, VariationValue } from './types'
import { logError, defaultOptions } from './utils'

const fetch = globalThis.fetch || require('node-fetch')

// event-source-polyfil works great in browsers, but not under node
// eventsource works great under node, but can't be bundled for browsers
const EventSource = globalThis.fetch ? EventSourcePolyfill : require('eventsource')

const initialize = (apiKey: string, target: Target, options: Options): Result => {
  let storage: Record<string, any> = {}
  const eventBus = mitt()
  const configurations = { ...defaultOptions, ...options }
  const logDebug = (message: string, ...args: any[]) => {
    if (configurations.debug) {
      // tslint:disable-next-line:no-console
      console.debug(`[FF-SDK] ${message}`, ...args)
    }
  }

  const authenticate = async (clientID: string, configuration: Options): Promise<string> => {
    const response = await fetch(`${configuration.baseUrl}/client/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: clientID })
    })

    const data: { authToken: string } = await response.json()

    return data.authToken
  }

  let environment: string
  let eventSource: any
  let jwtToken: string

  authenticate(apiKey, configurations)
    .then((token: string) => {
      jwtToken = token
      const decoded: { environment: string } = jwt_decode(token)

      logDebug('Authenticated', decoded)

      environment = decoded.environment

      // When authentication is done, fetch all flags
      fetchFlags()
        .then(() => {
          logDebug('Fetch all flags ok', storage)
        })
        .then(() => {
          startStream() // start stream only after we get all evaluations
        })
        .then(() => {
          logDebug('Event stream ready', { storage })
          eventBus.emit(Event.READY, storage)
        })
        .catch(err => {
          eventBus.emit(Event.ERROR, err)
        })
    })
    .catch(error => {
      logError('Authentication error: ', error)
      eventBus.emit(Event.ERROR, error)
    })

  const fetchFlags = async () => {
    try {
      const res = await fetch(
        `${configurations.baseUrl}/client/env/${environment}/target/${target.identifier}/evaluations`
      )
      const data = await res.json()

      data.forEach((elem: Evaluation) => {
        storage[elem.flag] = elem.value
      })
    } catch (error) {
      logError('Features fetch operation error: ', error)
      eventBus.emit(Event.ERROR, error)
      return error
    }
  }

  const fetchFlag = async (identifier: string) => {
    try {
      const result = await fetch(
        `${configurations.baseUrl}/client/env/${environment}/target/${target.identifier}/evaluations/${identifier}`,
        {
          headers: {
            Authorization: `Bearer ${jwtToken}`
          }
        }
      )

      if (result.ok) {
        const flagInfo: Evaluation = await result.json()
        storage[identifier] = flagInfo.value
        eventBus.emit(Event.CHANGED, flagInfo)
      } else {
        eventBus.emit(Event.ERROR, result)
      }
    } catch (error) {
      logError('Feature fetch operation error: ', error)
      eventBus.emit(Event.ERROR, error)
    }
  }

  const startStream = () => {
    // TODO: Implement polling when stream is disabled
    if (!configurations.streamEnabled) {
      logDebug('Stream is disabled by configuration. Note: Polling is not yet supported')
      return
    }
    eventSource = new EventSource(`${configurations.baseUrl}/stream`, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        'API-Key': apiKey
      }
    })

    eventSource.onopen = (event: any) => {
      logDebug('Stream connected', event)
      eventBus.emit(Event.CONNECTED)
    }

    eventSource.onclose = (event: any) => {
      logDebug('Stream disconnected')
      eventBus.emit(Event.DISCONNECTED)
    }

    eventSource.onerror = (event: any) => {
      logError('Stream has issue', event)
      eventBus.emit('error', event)
    }

    eventSource.addEventListener('*', (msg: any) => {
      const event: StreamEvent = JSON.parse(msg.data)

      logDebug('Received event from stream: ', event)

      switch (event.event) {
        case 'create':
          setTimeout(() => fetchFlag(event.identifier), 1000) // Wait a bit before fetching evaluation due to https://harness.atlassian.net/browse/FFM-583
          break
        case 'patch':
          fetchFlag(event.identifier)
          break
        case 'delete':
          delete storage[event.identifier]
          eventBus.emit(Event.CHANGED, { flag: event.identifier, value: undefined, deleted: true })
          logDebug('Evaluation deleted', { message: event, storage })
          // TODO: Delete flag from storage
          break
      }
    })
  }

  const on = (event: Event, callback: EventCallback): void => eventBus.on(event, callback)

  const off = (event?: Event, callback?: EventCallback): void => {
    if (event) {
      eventBus.off(event, callback)
    } else {
      close()
    }
  }

  const variation = (flag: string, defaultValue: any) => storage[flag] || defaultValue

  const close = () => {
    logDebug('Closing event stream')
    storage = {}
    eventBus.all.clear()
    eventSource.close()
  }

  return { on, off, variation, close }
}

export { initialize, Options, Target, StreamEvent, Event, EventCallback, Result, Evaluation, VariationValue }