import { err, ok, Result } from 'neverthrow'

import { analyzeKeys, errMsg, isLetter, isNumber, isWhiteSpace } from './utils'

export interface ParseOptions {
  /**
   * Define how empty tables are parsed
   *
   * Empty lua table could be an empty array or an empty object. This can't be determined by the parser.
   * - "object": parse empty tables as empty objects
   * - "array": parse empty tables as empty arrays
   *
   * @defaultValue "object"
   */
  emptyTables?: 'object' | 'array'
  /**
   * Allow boolean keys in tables
   *
   * Javascript object can only be indexed with string, so this can't be converted 1:1
   * - true: convert boolean keys to string
   * - false: throw error if boolean keys are encountered
   *
   * @defaultValue false
   */
  booleanKeys?: boolean
  /**
   * Allow tables with string and numeric keys
   *
   * Javascript object can only be indexed with string, so this can't be converted 1:1
   * - true: convert numeric keys to string, if string keys are present
   * - false: throw error, if table with mixed key types is encountered
   *
   * @defaultValue false
   */
  mixedKeyTypes?: boolean
  /**
   * Allow numeric table keys that are not positive integers
   *
   * Numeric keys should be array indices, this is not possible, if numeric keys are floats or <= 0
   * - true: convert tables with non-positive-integers keys to objects, keys are converted to strings
   * - false: throw error, if non-positive-integers keys are encountered
   *
   * @defaultValue false
   */
  nonPositiveIntegerKeys?: boolean
  /**
   * Allow sparse arrays
   *
   * Sparse arrays behave different in lua and javascript\
   * - true: Parse sparse arrays as sparse arrays
   * - false: throw error if input contains sparse array
   *
   * @defaultValue true
   */
  sparseArray?: boolean
}

/**
 * Parse stringified lua-table
 *
 * @param input string containing lua-table
 * @param options.emptyTables parse empty tables as object or array (Default object)
 * @param options.booleanKeys allow boolean keys in tables
 * @param options.mixedKeyTypes allow tables with string and numeric keys
 * @param options.nonPositiveIntegerKeys allow numeric keys that are not positive integers
 * @param options.sparseArray allow sparse arrays (default true)
 *
 * @returns Result containing parsed data or an error. Type depends on given input
 */
export function parse(input: string, options?: ParseOptions): Result<unknown, Error> {
  const parser = new Parser(input, options)
  return parser.parse()
}

class Parser {
  input: string
  pos: number
  options: ParseOptions

  constructor(input: string, options?: ParseOptions) {
    this.input = input
    this.pos = 0
    this.options = options ?? {}
  }

  public parse(): Result<unknown, Error> {
    if (typeof this.input !== 'string') {
      return err(new Error(errMsg.notString()))
    }
    if (this.input.length === 0) {
      return err(new Error(errMsg.empty()))
    }
    this.skipWhiteSpace()
    if (this.isEnd()) {
      return err(new Error(errMsg.end()))
    }
    const valueResult = this.tryValue()
    if (valueResult.isErr()) {
      return valueResult
    }
    const value = valueResult.value
    if (value === undefined) {
      return err(new Error(this.invalidMessage()))
    }
    this.skipWhiteSpace()
    if (!this.isEnd()) {
      return err(new Error(this.invalidMessage()))
    }
    return ok(value)
  }

  isEnd() {
    return this.pos >= this.input.length
  }

  currentChar() {
    return this.input.charAt(this.pos)
  }

  invalidMessage() {
    if (this.isEnd()) {
      return errMsg.end()
    }
    const surround = this.input.slice(Math.max(0, this.pos - 10), this.pos + 10)
    return errMsg.invalid(this.currentChar(), this.pos, this.getLinePos(), surround)
  }

  /**
   * Every failed `try*` builds its message, so this runs once per attempt. Scanning from the start
   * each time made a 1 MB mission file take minutes; the newline index is built once instead.
   */
  getLinePos() {
    this.newlines ??= this.indexNewlines()
    let low = 0
    let high = this.newlines.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (this.newlines[mid]! < this.pos) low = mid + 1
      else high = mid
    }
    const line = low + 1
    const col = low === 0 ? this.pos : this.pos - this.newlines[low - 1]!
    return { line, col }
  }

  private newlines: number[] | undefined

  private indexNewlines() {
    const newlines: number[] = []
    for (let i = this.input.indexOf('\n'); i !== -1; i = this.input.indexOf('\n', i + 1)) {
      newlines.push(i)
    }
    return newlines
  }

  tryValue(): Result<unknown, Error> {
    const stringResult = this.tryString()
    if (stringResult.isOk()) {
      return stringResult
    }
    const numberResult = this.tryNumber()
    if (numberResult.isOk()) {
      return numberResult
    }
    const booleanResult = this.tryBoolean()
    if (booleanResult.isOk()) {
      return booleanResult
    }
    const nilResult = this.tryNil()
    if (nilResult.isOk()) {
      return nilResult
    }
    return this.tryTable()
  }

  tryTable(): Result<unknown, Error> {
    if (this.currentChar() !== '{') {
      return err(new Error(this.invalidMessage()))
    }
    this.pos++

    const arrEntries: unknown[] = []
    const entries = new Map<string | number, unknown>()
    while (!this.isEnd()) {
      this.skipWhiteSpace()
      if (this.currentChar() === '}') {
        this.pos++
        return this.finalizeTable(arrEntries, entries)
      }
      const valueResult = this.tryValue()
      if (valueResult.isOk()) {
        arrEntries.push(valueResult.value)
      } else {
        const keyResult = this.tryKey()
        let key: string | number | undefined
        if (keyResult.isOk()) {
          key = keyResult.value
        } else {
          const literalResult = this.tryLiteral()
          if (literalResult.isOk()) {
            key = literalResult.value
          } else {
            return err(new Error(this.invalidMessage()))
          }
        }
        if (key === undefined) {
          return err(new Error(this.invalidMessage()))
        }
        const valueResult2 = this.tryValue()
        if (valueResult2.isErr()) {
          return valueResult2
        }
        entries.set(key, valueResult2.value)
      }
      this.skipWhiteSpace()
      if (this.currentChar() === ',' || this.currentChar() === ';') {
        this.pos++
        this.skipWhiteSpace()
      } else if (this.currentChar() === '}') {
        this.pos++
        return this.finalizeTable(arrEntries, entries)
      } else {
        return err(new Error(this.invalidMessage()))
      }
    }
    return err(new Error(errMsg.end()))
  }

  tryKey(): Result<string | number, Error> {
    if (this.currentChar() !== '[') {
      return err(new Error(this.invalidMessage()))
    }
    this.pos++
    this.skipWhiteSpace()
    const keyResult = this.tryString()
    let key: string | number | undefined
    if (keyResult.isOk()) {
      key = keyResult.value
    } else {
      const numResult = this.tryNumber()
      if (numResult.isOk()) {
        key = numResult.value
      }
    }
    if (key == undefined && this.options.booleanKeys) {
      const boolResult = this.tryBoolean()
      if (boolResult.isOk()) {
        key = boolResult.value.toString()
      }
    }
    if (key == undefined) {
      return err(new Error(this.invalidMessage()))
    }
    this.skipWhiteSpace()
    if (this.currentChar() !== ']') {
      return err(new Error(this.invalidMessage()))
    }
    this.pos++
    this.skipWhiteSpace()
    if (this.currentChar() !== '=') {
      return err(new Error(this.invalidMessage()))
    }
    this.pos++
    this.skipWhiteSpace()
    return ok(key)
  }

  tryLiteral(): Result<string, Error> {
    const char = this.currentChar()
    if (char !== '_' && !isLetter(char)) {
      return err(new Error(this.invalidMessage()))
    }
    const start = this.pos
    while (++this.pos < this.input.length) {
      const char = this.currentChar()
      if (char === '_' || isNumber(char) || isLetter(char)) {
        continue
      }
      const end = this.pos
      this.skipWhiteSpace()
      if (this.currentChar() !== '=') {
        return err(new Error(this.invalidMessage()))
      }
      this.pos++
      this.skipWhiteSpace()
      return ok(this.input.slice(start, end))
    }
    return err(new Error(errMsg.end()))
  }

  tryString(): Result<string, Error> {
    const quote = this.currentChar()
    if (quote !== '"' && quote !== "'") {
      return err(new Error(this.invalidMessage()))
    }
    const start = this.pos + 1
    let escaped = false
    while (++this.pos < this.input.length) {
      if (escaped) {
        escaped = false
        continue
      }
      const char = this.currentChar()
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === quote) {
        this.pos++
        return ok(unescapeLuaString(this.input.slice(start, this.pos - 1)))
      }
    }
    return err(new Error(errMsg.end()))
  }

  tryNumber(): Result<number, Error> {
    let char = this.currentChar()
    if (char !== '.' && char !== '-' && !isNumber(char)) {
      return err(new Error(this.invalidMessage()))
    }
    let pos = this.pos
    let decimal = char === '.'
    let exponent = false
    while (++pos < this.input.length) {
      char = this.input.charAt(pos)
      if (char === '.' && !decimal) {
        decimal = true
      } else if (char === 'e' && !exponent) {
        const nextChar = this.input.charAt(pos + 1)
        if (nextChar === '+' || nextChar === '-') {
          pos++
        }
        exponent = true
      } else if (!isNumber(char)) {
        break
      }
    }
    const num = Number.parseFloat(this.input.slice(this.pos, pos))
    if (Number.isNaN(num)) {
      return err(new Error(this.invalidMessage()))
    }
    this.pos = pos
    return ok(num)
  }

  tryBoolean(): Result<boolean, Error> {
    if (this.input.slice(this.pos, this.pos + 4) === 'true') {
      this.pos += 4
      return ok(true)
    }
    if (this.input.slice(this.pos, this.pos + 5) === 'false') {
      this.pos += 5
      return ok(false)
    }
    return err(new Error(this.invalidMessage()))
  }

  tryNil(): Result<null, Error> {
    if (this.input.slice(this.pos, this.pos + 3) === 'nil') {
      this.pos += 3
      return ok(null)
    }
    return err(new Error(this.invalidMessage()))
  }

  /** skip whitespace and also comments */
  skipWhiteSpace() {
    while (this.pos < this.input.length) {
      const char = this.currentChar()
      if (isWhiteSpace(char)) {
        this.pos++
      } else if (this.input.slice(this.pos, this.pos + 2) === '--') {
        if (this.input.slice(this.pos + 2, this.pos + 4) === '[[') {
          this.pos += 4
          while (!this.isEnd() && this.input.slice(this.pos, this.pos + 2) !== ']]') {
            this.pos++
          }
          this.pos += 2
        } else {
          this.pos += 2
          while (!this.isEnd() && this.currentChar() !== '\n') {
            this.pos++
          }
          this.pos++
        }
      } else {
        return
      }
    }
  }

  finalizeTable(
    arrEntries: unknown[],
    entries: Map<string | number, unknown>
  ): Result<unknown[] | Record<string, unknown>, Error> {
    arrEntries.forEach((v, i) => entries.set(i + 1, v))
    const keys = [...entries.keys()]
    const { hasStringKey, hasNumKeys, hasNonArrayNumKeys } = analyzeKeys(keys)

    if (hasNonArrayNumKeys && !this.options.nonPositiveIntegerKeys) {
      return err(new Error(errMsg.nonPosIntKeys()))
    }

    if (hasStringKey) {
      if (hasNumKeys && !this.options.mixedKeyTypes) {
        return err(new Error(errMsg.mixed()))
      }
      return ok(Object.fromEntries(entries.entries()))
    } else {
      if (!hasNumKeys) {
        return ok(this.options.emptyTables === 'array' ? [] : {})
      }
      if (hasNonArrayNumKeys) {
        return ok(Object.fromEntries(entries.entries()))
      }
      const arr: unknown[] = []
      for (const [i, v] of entries.entries()) {
        if (typeof i === 'string') {
          return err(new Error(errMsg.error()))
        }
        arr[i - 1] = v
      }
      if (this.options.sparseArray === false) {
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] == undefined) {
            return err(new Error(errMsg.sparse()))
          }
        }
      }
      return ok(arr)
    }
  }
}

function unescapeLuaString(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (char !== '\\' || index === value.length - 1) {
      result += char
      continue
    }

    const escapedChar = value[++index]
    switch (escapedChar) {
      case 'n':
        result += '\n'
        break
      case 'r':
        result += '\r'
        break
      case 't':
        result += '\t'
        break
      case '"':
        result += '"'
        break
      case "'":
        result += "'"
        break
      case '\\':
        result += '\\'
        break
      default:
        result += escapedChar
        break
    }
  }
  return result
}
