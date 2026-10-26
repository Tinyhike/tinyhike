import { describe, it, expect } from 'vitest'
import { clientKey } from '../src/lib/client-key.js'

describe('clientKey', () => {
  it('keeps IPv4 addresses as they are', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7')
  })

  it('groups every address of one IPv6 /64 under the same key', () => {
    const a = clientKey('2001:db8:abcd:12:1:2:3:4')
    const b = clientKey('2001:db8:abcd:12:ffff:ffff:ffff:ffff')
    expect(a).toBe('2001:db8:abcd:12::/64')
    expect(b).toBe(a)
  })

  it('keeps different /64s apart', () => {
    expect(clientKey('2001:db8:abcd:12::1')).not.toBe(clientKey('2001:db8:abcd:13::1'))
  })

  it('normalises compressed forms, leading zeros and case', () => {
    expect(clientKey('2001:0DB8:0000:0012::1')).toBe('2001:db8:0:12::/64')
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(clientKey('::1')).toBe('0:0:0:0::/64')
  })

  it('treats IPv4-mapped IPv6 as the IPv4 client it is', () => {
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7')
  })

  it('handles an embedded IPv4 tail and a zone id', () => {
    expect(clientKey('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64')
    expect(clientKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
  })

  it('passes anything that is not an IP through unchanged', () => {
    expect(clientKey('not-an-ip')).toBe('not-an-ip')
  })
})
