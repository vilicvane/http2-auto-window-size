import assert from 'assert';
import type {Http2Session} from 'http2';

const BANDWIDTH_CALCULATION_INTERVAL_DEFAULT = 200;

const MIN_WINDOW_SIZE_DEFAULT = 64 * 1024; // 64 KB

const WINDOW_SIZE_FACTOR_DEFAULT = 2;

const WINDOW_SIZE_REDUCING_RTT_THRESHOLD_FACTOR_DEFAULT = 5;

const INITIAL_PING_DURATION_REFERENCE_DEFAULT = 100;

const PING_INTERVAL_FACTOR_DEFAULT = 50;

export type AutoWindowSizeOptions = {
  /**
   * @default 200 (ms)
   */
  bandwidthCalculationInterval?: number;
  initialWindowSize?: number;
  /**
   * @default 64 * 1024 (64 KB)
   */
  minWindowSize?: number;
  /**
   * The actual window size set is calculated by `[estimated window size] *
   * [window size factor]`. The greater the factor is, the faster the window
   * size and useable bandwidth grow (as latency becoming the trade off).
   *
   * @default 2
   */
  windowSizeFactor?: number;
  /**
   * Window size will only be reduced if the ping duration is greater than `[min
   * RTT] * [window size reducing RTT threshold factor]`. Greater value means
   * more tolerant to ping duration fluctuation.
   *
   * @default 5
   */
  windowSizeReducingRTTThresholdFactor?: number;
  /**
   * The initial ping duration reference is used to calculate the initial ping
   * interval.
   *
   * @default 100 (ms)
   */
  initialPingDurationReference?: number;
  /**
   * The ping interval is calculated by `[ping duration] * [ping interval
   * factor]`.
   *
   * @default 50
   */
  pingIntervalFactor?: number;
  onSetLocalWindowSize?: (windowSize: number) => void;
  onPingCallback?: (duration: number) => void;
};

/**
 * @see https://github.com/vilic/http2-auto-window-size
 */
export function setupAutoWindowSize(
  session: Http2Session,
  {
    bandwidthCalculationInterval = BANDWIDTH_CALCULATION_INTERVAL_DEFAULT,
    initialWindowSize,
    minWindowSize = MIN_WINDOW_SIZE_DEFAULT,
    windowSizeFactor = WINDOW_SIZE_FACTOR_DEFAULT,
    windowSizeReducingRTTThresholdFactor = WINDOW_SIZE_REDUCING_RTT_THRESHOLD_FACTOR_DEFAULT,
    initialPingDurationReference = INITIAL_PING_DURATION_REFERENCE_DEFAULT,
    pingIntervalFactor = PING_INTERVAL_FACTOR_DEFAULT,
    onSetLocalWindowSize,
    onPingCallback,
  }: AutoWindowSizeOptions = {},
): void {
  if (initialWindowSize !== undefined) {
    assert(initialWindowSize >= minWindowSize);
    session.setLocalWindowSize(initialWindowSize);
  }

  let recentRTT: number | undefined;
  let minRTT: number | undefined;

  setupSessionPing(
    session,
    initialPingDurationReference,
    pingIntervalFactor,
    duration => {
      recentRTT = duration;
      minRTT = Math.min(minRTT ?? Infinity, recentRTT);

      onPingCallback?.(duration);
    },
  );

  let receivedSinceLastBandwidthCalculation = 0;
  let bandwidthCalculatedAt = Date.now();

  const timer = setInterval(() => {
    const now = Date.now();

    const duration = now - bandwidthCalculatedAt;
    const received = receivedSinceLastBandwidthCalculation;

    receivedSinceLastBandwidthCalculation = 0;
    bandwidthCalculatedAt = now;

    if (duration <= 0) {
      return;
    }

    const {effectiveLocalWindowSize} = session.state;

    if (effectiveLocalWindowSize === undefined) {
      return;
    }

    const bandwidth = received / duration; // bytes/ms

    if (minRTT === undefined || recentRTT === undefined) {
      return;
    }

    const refWindowSize = bandwidth * minRTT;

    const windowSize = Math.max(
      Math.ceil(refWindowSize * windowSizeFactor),
      MIN_WINDOW_SIZE_DEFAULT,
    );

    if (
      windowSize > effectiveLocalWindowSize ||
      (windowSize < effectiveLocalWindowSize &&
        recentRTT > minRTT * windowSizeReducingRTTThresholdFactor)
    ) {
      session.setLocalWindowSize(windowSize);
      onSetLocalWindowSize?.(windowSize);
    }
  }, bandwidthCalculationInterval);

  session
    .on('stream', stream => {
      const push = stream.push;

      stream.push = function (data: Buffer | null) {
        if (data) {
          receivedSinceLastBandwidthCalculation += data.length;
        }

        return push.call(stream, data);
      };
    })
    .on('close', () => clearInterval(timer));
}

function setupSessionPing(
  session: Http2Session,
  initialDurationReference: number,
  pingIntervalFactor: number,
  callback: (duration: number) => void,
): void {
  let timer: NodeJS.Timeout | undefined;

  session.on('close', () => clearInterval(timer));

  ping();
  update(initialDurationReference);

  function update(duration: number): void {
    clearInterval(timer);

    timer = setInterval(() => ping(), duration * pingIntervalFactor);
  }

  function ping(): void {
    if (session.destroyed) {
      clearInterval(timer);
      return;
    }

    session.ping((error, duration) => {
      if (error) {
        return;
      }

      callback(duration);
      update(duration);
    });
  }
}
