import { describe, it, expect } from 'vitest'
import { Result } from './Result'

describe('Result', () => {
  it('ok() produces a successful result carrying the value', () => {
    const result = Result.ok<number, Error>(42)
    expect(result.isOk()).toBe(true)
    expect(result.isFail()).toBe(false)
    expect(result.value).toBe(42)
  })

  it('fail() produces a failed result carrying the error', () => {
    const error = new Error('boom')
    const result = Result.fail<number, Error>(error)
    expect(result.isOk()).toBe(false)
    expect(result.isFail()).toBe(true)
    expect(result.error).toBe(error)
  })

  it('accessing value on a failed result throws', () => {
    const result = Result.fail<number, Error>(new Error('boom'))
    expect(() => result.value).toThrow()
  })

  it('accessing error on a successful result throws', () => {
    const result = Result.ok<number, Error>(1)
    expect(() => result.error).toThrow()
  })
})
