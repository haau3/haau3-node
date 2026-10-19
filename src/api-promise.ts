/** What the API answered besides the body: the same names {@link Transport.request} uses. */
export interface ResponseMeta {
  /** The `X-Request-Id` the API sent. Quote it when you ask for help. */
  requestId: string | undefined;
  /**
   * The `correlationId` you sent, as the API returned it in `X-Correlation-Id`: proof it was kept
   * with the API's record of the request. Unset when you sent none.
   */
  correlationId: string | undefined;
  /** Milliseconds from the first attempt to the answer, waits between attempts included. */
  durationMs: number;
  /** How many attempts were made. */
  attempts: number;
  status: number;
  headers: Headers;
}

/** A typed call's answer together with what came with it. */
export type WithResponse<T> = ResponseMeta & { data: T };

/**
 * What every typed method returns: a promise of the answer, as before, that can also give the
 * request id and timing that came with it.
 *
 * ```ts
 * const plan = await haau3.readInsurancePlan(id);
 * const { data, requestId, durationMs } = await haau3.readInsurancePlan(id).withResponse();
 * ```
 *
 * The request is sent once, when the method is called, whichever way it is awaited.
 */
export class APIPromise<T> extends Promise<T> {
  readonly #response: Promise<WithResponse<T>>;

  constructor(response: Promise<WithResponse<T>>) {
    // The value this base promise holds is never read: every way of reading it goes through
    // `#response` below.
    super((resolve) => resolve(undefined as T));
    this.#response = response;
  }

  /** The answer, its request id, its timing, its status and its headers. */
  withResponse(): Promise<WithResponse<T>> {
    return this.#response;
  }

  override then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.#response.then((response) => response.data).then(onfulfilled, onrejected);
  }

  override catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.then(undefined, onrejected);
  }

  override finally(onfinally?: (() => void) | null): Promise<T> {
    return this.then().finally(onfinally);
  }

  /** `Promise.prototype.then` and friends build plain promises from an APIPromise. */
  static override get [Symbol.species]() {
    return Promise;
  }
}
