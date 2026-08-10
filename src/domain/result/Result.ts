export class Result<T, E> {
  private constructor(
    private readonly _isOk: boolean,
    private readonly _value: T | undefined,
    private readonly _error: E | undefined
  ) {}

  static ok<T, E>(value: T): Result<T, E> {
    return new Result<T, E>(true, value, undefined)
  }

  static fail<T, E>(error: E): Result<T, E> {
    return new Result<T, E>(false, undefined, error)
  }

  isOk(): boolean {
    return this._isOk
  }

  isFail(): boolean {
    return !this._isOk
  }

  get value(): T {
    if (!this._isOk) {
      throw new Error('Cannot access value of a failed Result')
    }
    return this._value as T
  }

  get error(): E {
    if (this._isOk) {
      throw new Error('Cannot access error of a successful Result')
    }
    return this._error as E
  }
}
